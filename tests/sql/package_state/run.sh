#!/bin/bash
# Throwaway local Postgres check for package_state_rules / rollover / tenant_billing_state.
# Usage: PGHOST=/tmp PGPORT=55432 PGUSER=postgres tests/sql/package_state/run.sh
# Builds a fresh database "pkg_state_test" from a stub of the prod tables, applies the
# real SQL files twice (re-run safety), then runs the scenarios. Never point at Supabase.
set -euo pipefail
cd "$(dirname "$0")/../../.."
DB=pkg_state_test
P="psql -v ON_ERROR_STOP=1 -q"
D=tests/sql/package_state
tmp=$(mktemp)
sed '/^-- 2. Schedule/,$d' docs/supabase/package_period_rollover.sql > "$tmp"   # no pg_cron locally
$P -c "drop database if exists $DB" -c "create database $DB"
$P -d $DB -f $D/00_stub_schema.sql
$P -d $DB -f docs/supabase/package_catalog.sql
$P -d $DB -f $D/05_legacy_rows.sql
for pass in 1 2; do
  for f in docs/supabase/fix_grant_package_minutes.sql docs/supabase/package_state_rules.sql "$tmp" docs/supabase/tenant_billing_state.sql; do
    $P -d $DB -f "$f"
  done
done
$P -d $DB -f $D/10_rules.sql
$P -d $DB -f $D/20_owner_rls.sql
rm -f "$tmp"
