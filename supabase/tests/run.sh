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

dropdb -h "$HOST" -p "$PORT" -U "$USER" --if-exists "$DB"
createdb -h "$HOST" -p "$PORT" -U "$USER" "$DB"

# Napodobenina prostředí Supabase (auth.users, auth.uid, role). V produkci
# tohle dodává samo Supabase — soubor se tam nikdy nepouští.
$PSQL -d "$DB" -f "$ROOT/supabase/tests/00_harness.sql"

for f in "$ROOT"/supabase/migrations/*.sql; do
  printf '%-52s' "$(basename "$f")"
  $PSQL -d "$DB" -f "$f" >/dev/null && echo "OK"
done

echo
for t in etapa0_scenar krok2_scenar krok3_scenar; do
  $PSQL -d "$DB" -f "$ROOT/supabase/tests/$t.sql" 2>&1 \
    | grep -E '^(==|psql.*(OK |SELHALO))| VŠECHNY| KROK' \
    | sed 's/^psql[^ ]* NOTICE: //'
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

$PSQL -d "$DB" -f "$ROOT/supabase/seed/test-provoz.sql" 2>&1 \
  | sed -n 's/^psql[^ ]* NOTICE:  /  /p'
PRVNI="$(pocty)"
echo "  OK    seed proběhl proti čisté databázi ($PRVNI)"

$PSQL -d "$DB" -f "$ROOT/supabase/seed/test-provoz.sql" >/dev/null 2>&1
DRUHY="$(pocty)"

if [ "$PRVNI" = "$DRUHY" ]; then
  echo "  OK    opakovaný běh nic nezaložil podruhé"
else
  echo "SELHALO: opakovaný seed změnil data ($PRVNI → $DRUHY)"
  exit 1
fi

echo
echo '=========================================================='
echo ' SEED — VŠECHNY KONTROLY PROŠLY'
echo '=========================================================='
