#!/usr/bin/env bash
# Runs the Supabase migrations against a throwaway Postgres container and checks the
# row-level security rules. Usage: tests/db/run.sh   (needs Docker)
set -euo pipefail
cd "$(dirname "$0")/../.."
name="uneswa-db-test-$$"
docker run -d --rm --name "$name" -e POSTGRES_PASSWORD=test postgres:16 >/dev/null
trap 'docker stop "$name" >/dev/null' EXIT
until docker exec "$name" pg_isready -U postgres -q 2>/dev/null; do sleep 0.5; done
sleep 1
psql_run(){ docker exec -i "$name" psql -qtA -v ON_ERROR_STOP=1 -U postgres "$@"; }
psql_run < tests/db/00_supabase_stub.sql
psql_run < tests/db/01_legacy_schema.sql
for f in supabase/migrations/*.sql; do echo "== $f"; psql_run < "$f"; done
echo "== re-running migrations (must be idempotent)"
for f in supabase/migrations/*.sql; do psql_run < "$f"; done
echo "== RLS checks"
psql_run < tests/db/10_rls_test.sql 2>&1 | sed 's/^psql:[^ ]* NOTICE:  //'
echo "All database checks passed."
