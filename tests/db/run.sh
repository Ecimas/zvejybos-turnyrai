#!/usr/bin/env bash
# Paleidžia schemos testus švarioje laikinoje Postgres duomenų bazėje.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

# Postgres negali veikti kaip root – tokiu atveju paleidžiam save kaip „postgres“ vartotoją.
if [ "$(id -u)" = "0" ]; then
  COPY="$(mktemp -d)"
  cp -r "$ROOT/supabase" "$ROOT/tests" "$COPY/"
  chown -R postgres "$COPY"
  status=0
  runuser -u postgres -- bash "$COPY/tests/db/run.sh" || status=$?
  rm -rf "$COPY"
  exit $status
fi
PGBIN="${PGBIN:-/usr/lib/postgresql/16/bin}"
WORK="$(mktemp -d)"
PORT="${PGPORT_TEST:-54329}"

cleanup() { "$PGBIN/pg_ctl" -D "$WORK/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$WORK"; }
trap cleanup EXIT

"$PGBIN/initdb" -D "$WORK/data" -U postgres --auth=trust -E UTF8 --locale=C.UTF-8 >/dev/null
"$PGBIN/pg_ctl" -D "$WORK/data" -o "-p $PORT -k $WORK -c listen_addresses=''" -l "$WORK/log" -w start >/dev/null

PSQL=(psql -h "$WORK" -p "$PORT" -U postgres -d postgres -X -q -v ON_ERROR_STOP=1)

"${PSQL[@]}" -c "create extension pgcrypto;"
"${PSQL[@]}" -f "$ROOT/tests/db/supabase_stub.sql"
"${PSQL[@]}" -f "$ROOT/supabase/migrations/0001_init.sql"
"${PSQL[@]}" -f "$ROOT/supabase/migrations/0002_storage.sql"
"${PSQL[@]}" -f "$ROOT/supabase/migrations/0003_location_retention.sql"
"${PSQL[@]}" -f "$ROOT/supabase/migrations/0004_rls_performance.sql"
"${PSQL[@]}" -f "$ROOT/supabase/migrations/0005_limits_and_trust.sql"
for f in 0006a_catch_and_tournament_fields 0006b_disputes_and_moderators 0006c_account_deletion 0007_photo_path_strict 0008_private_catch_notes 0009_prize_fund; do "${PSQL[@]}" -f "$ROOT/supabase/migrations/$f.sql"; done
"${PSQL[@]}" -f "$ROOT/supabase/seed.sql"
"${PSQL[@]}" -f "$ROOT/tests/db/test_schema.sql"
"${PSQL[@]}" -f "$ROOT/tests/db/test_features.sql"
"${PSQL[@]}" -f "$ROOT/tests/db/test_prizes.sql"
"${PSQL[@]}" -f "$ROOT/tests/db/test_rls_fuzz.sql"
