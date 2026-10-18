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
tmp_rs=$(mktemp)
sed '/^-- 8. Cron/,$d' docs/supabase/notify_send_reserve_settle.sql > "$tmp_rs"   # no pg_cron locally
$P -c "drop database if exists $DB" -c "create database $DB"
$P -d $DB -f $D/00_stub_schema.sql
$P -d $DB -f docs/supabase/package_catalog.sql
$P -d $DB -f docs/supabase/notify_send_ledger.sql
$P -d $DB -f docs/supabase/sms_allowance.sql
$P -d $DB -f "$tmp_rs"
$P -d $DB -f $D/05_legacy_rows.sql
for pass in 1 2; do
  for f in docs/supabase/fix_grant_package_minutes.sql docs/supabase/package_state_rules.sql "$tmp" docs/supabase/tenant_billing_state.sql docs/supabase/on_demand_usage_audit.sql; do
    $P -d $DB -f "$f"
  done
done
$P -d $DB -f $D/10_rules.sql
$P -d $DB -f $D/20_owner_rls.sql
$P -d $DB -f $D/30_rollover_catchup_audit.sql
# Staging D&D reconcile: run the real script twice (second run must be a no-op).
$P -d $DB -f $D/35_dnd_setup.sql
$P -d $DB -f docs/supabase/staging/dnd_usage_counter_reconcile.sql
$P -d $DB -f docs/supabase/staging/dnd_usage_counter_reconcile.sql
$P -d $DB -f $D/40_dnd_reconcile_check.sql
rm -f "$tmp" "$tmp_rs"
