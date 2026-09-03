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
  return 1
}

# Migrace, harness a seed se obejít nedají: co po nich přijde, na nich
# stojí. Když spadne migrace, nemá cenu pouštět scénáře nad databází,
# která není celá.
spustit_nebo_konec() {
  if spustit "$1"; then
    return 0
  fi
  echo "Do pádu prošlo kontrol: $POCET"
  exit 1
}

# Scénáře naopak běží VŠECHNY. Jeden rozbitý nesmí schovat zbytek —
# CLAUDE.md, „Dvě relace v jednom repozitáři", pravidlo 4.
#
# Dřív se tu končilo hned první chybou. 3. 9. na tom spadl marketingový
# scénář a s ním celý běh: nedalo se poznat, jestli počet kontrol je
# celý obrázek, nebo jen to, co stihlo běžet před pádem. Teď se doběhne
# a na konci se vypíše, co spadlo.
SPADLE=""
spustit_scenar() {
  if spustit "$1"; then
    return 0
  fi
  SPADLE="$SPADLE $(basename "$1")"
  return 0
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
spustit_nebo_konec "$ROOT/supabase/tests/00_harness.sql"

for f in "$ROOT"/supabase/migrations/*.sql; do
  printf '%-52s' "$(basename "$f")"
  spustit_nebo_konec "$f"
  echo "OK"
done

echo
for t in etapa0_scenar krok2_scenar krok3_scenar krok4_scenar krok5_scenar krok6_scenar krok7_scenar krok8_scenar krok9_scenar krok10_scenar krok11_scenar krok12_scenar krok13_scenar krok14_scenar krok15_scenar krok16_scenar krok17_scenar krok19_scenar krok20_scenar krok21_scenar krok22_scenar; do
  spustit_scenar "$ROOT/supabase/tests/$t.sql"
  grep -E '^(==|psql.*(OK |SELHALO))| VŠECHNY| KROK' "$VYSTUP" \
    | sed 's/^psql[^ ]* NOTICE: //' || true
  pricist_kontroly
done

# Marketing má vlastní číselnou řadu (marketingN_scenar.sql), oddělenou
# od provozní krokN_scenar.sql — CLAUDE.md, „Dvě relace v jednom
# repozitáři", pravidlo 3. Vlastní smyčka, ať přidání dalšího scénáře
# v jednom modulu nikdy nevyžaduje úpravu řádku patřícího tomu druhému.
echo
for t in marketing1_scenar; do
  spustit_scenar "$ROOT/supabase/tests/$t.sql"
  grep -E '^(==|psql.*(OK |SELHALO))| VŠECHNY| MARKETING' "$VYSTUP" \
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

spustit_nebo_konec "$ROOT/supabase/seed/test-provoz.sql"
sed -n 's/^psql[^ ]* NOTICE:  /  /p' "$VYSTUP" || true
PRVNI="$(pocty)"
echo "  OK    seed proběhl proti čisté databázi ($PRVNI)"
POCET=$(( POCET + 1 ))

spustit_nebo_konec "$ROOT/supabase/seed/test-provoz.sql"
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
if [ -n "$SPADLE" ]; then
  # Nejdřív se doběhne, teprve pak se skončí nenulově. Jinak se nedá
  # poznat, jestli je počet kontrol celý obrázek, nebo jen to, co
  # stihlo běžet před pádem.
  echo " SPADLÉ SCÉNÁŘE:$SPADLE"
  echo " Kontrol prošlo: $POCET (bez těch ze spadlých souborů)"
  echo '=========================================================='
  exit 1
fi
echo " VŠECHNY KONTROLY PROŠLY"
echo " Kontrol celkem: $POCET"
echo '=========================================================='
