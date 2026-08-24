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
