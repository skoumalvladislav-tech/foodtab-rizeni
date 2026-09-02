#!/usr/bin/env bash
# Spustí všechny migrace proti čisté lokální databázi a projde scénáře.
# Vyžaduje lokální PostgreSQL 15+. Produkční databáze se nedotýká.
set -euo pipefail

HOST="${PGHOST:-/tmp}"
PORT="${PGPORT:-5433}"
USER="${PGUSER:-postgres}"
DB="${PGDATABASE:-foodtab_test}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PSQL="psql -h $HOST -p $PORT -U $USER -v ON_ERROR_STOP=1 -q"

VYSTUP="$(mktemp)"
trap 'rm -f "$VYSTUP"' EXIT

POCET=0

# Spustí psql nad jedním souborem a NIKDY nespolkne chybu.
#
# Dřív šel výstup rovnou do grepu (a u migrací do /dev/null). Filtr
# propouštěl jen řádky s OK a SELHALO, takže chybová hláška z psql
# zmizela: běh se po prvním pádu tiše utnul, seed se nespustil a
# závěrečný banner se nevypsal — a nikde nestálo proč. Test, který umí
# spadnout a vypadat přitom jako průchod, je horší než žádný.
#
# Filtrovaný výpis je proto až tady, z uloženého souboru, a jen pro
# čitelnost ÚSPĚŠNÉHO běhu. Při nenulovém návratovém kódu se vypíše
# všechno, co psql řekl, a skript skončí nenulově.
spustit() {
  if $PSQL -d "$DB" -f "$1" > "$VYSTUP" 2>&1; then
    return 0
  fi
  echo
  echo '=========================================================='
  echo " SELHALO: $(basename "$1")"
  echo '=========================================================='
  cat "$VYSTUP"
  echo
  echo "Do pádu prošlo kontrol: $POCET"
  exit 1
}

# Kolik kontrol proběhlo v posledním souboru. Sčítá se přes celý běh,
# aby byl useknutý běh vidět na první pohled podle nižšího čísla.
pricist_kontroly() {
  POCET=$(( POCET + $(grep -c 'OK    ' "$VYSTUP" || true) ))
}

dropdb -h "$HOST" -p "$PORT" -U "$USER" --if-exists "$DB"
createdb -h "$HOST" -p "$PORT" -U "$USER" "$DB"

# Napodobenina prostředí Supabase (auth.users, auth.uid, role). V produkci
# tohle dodává samo Supabase — soubor se tam nikdy nepouští.
spustit "$ROOT/supabase/tests/00_harness.sql"

for f in "$ROOT"/supabase/migrations/*.sql; do
  printf '%-52s' "$(basename "$f")"
  spustit "$f"
  echo "OK"
done

echo
for t in etapa0_scenar krok2_scenar krok3_scenar krok4_scenar krok5_scenar krok6_scenar krok7_scenar krok8_scenar krok9_scenar krok10_scenar krok11_scenar krok12_scenar krok13_scenar krok14_scenar; do
  spustit "$ROOT/supabase/tests/$t.sql"
  grep -E '^(==|psql.*(OK |SELHALO))| VŠECHNY| KROK' "$VYSTUP" \
    | sed 's/^psql[^ ]* NOTICE: //' || true
  pricist_kontroly
done

# Seed testovacích dat. Není součástí migrací a v ostrém provozu se nepouští,
# ale překlep nebo porušené omezení v něm se jinak pozná až ve chvíli, kdy ho
# někdo ručně vkládá do SQL editoru. Kontroluje se i to, že opakovaný běh
# nic nezaloží podruhé — seed se pouští víckrát a nesmí data zdvojovat.
echo
echo '== Seed testovacích dat =================================='

pocty() {
  psql -h "$HOST" -p "$PORT" -U "$USER" -d "$DB" -tAc "select
    (select count(*) from public.employees)
      || '/' || (select count(*) from public.shifts)
      || '/' || (select count(*) from public.tasks)
      || '/' || (select count(*) from public.checklist_items)
      || '/' || (select count(*) from public.announcements)"
}

spustit "$ROOT/supabase/seed/test-provoz.sql"
sed -n 's/^psql[^ ]* NOTICE:  /  /p' "$VYSTUP" || true
PRVNI="$(pocty)"
echo "  OK    seed proběhl proti čisté databázi ($PRVNI)"
POCET=$(( POCET + 1 ))

spustit "$ROOT/supabase/seed/test-provoz.sql"
DRUHY="$(pocty)"

if [ "$PRVNI" = "$DRUHY" ]; then
  echo "  OK    opakovaný běh nic nezaložil podruhé"
  POCET=$(( POCET + 1 ))
else
  echo "SELHALO: opakovaný seed změnil data ($PRVNI → $DRUHY)"
  echo "Do pádu prošlo kontrol: $POCET"
  exit 1
fi

echo
echo '=========================================================='
echo " SEED — VŠECHNY KONTROLY PROŠLY"
echo " Kontrol celkem: $POCET"
echo '=========================================================='
