#!/bin/bash
# Throwaway local Postgres check for archive billing, admin suspension and purge.
# Usage: PGHOST=/tmp PGPORT=55433 PGUSER=postgres tests/sql/archive_billing/run.sh
# Builds a fresh database from a stub of the prod tables, applies the real SQL
# files twice (re-run safety), then runs the scenarios. Never point at Supabase.
set -euo pipefail
cd "$(dirname "$0")/../../.."
DB=archive_billing_test
P="psql -v ON_ERROR_STOP=1 -q"
D=tests/sql/archive_billing
$P -c "drop database if exists $DB" -c "create database $DB"
$P -d $DB -f $D/00_stub_schema.sql
for pass in 1 2; do
  for f in docs/supabase/line_rental_grace.sql docs/supabase/admin_business_archive.sql \
           docs/supabase/admin_business_suspend.sql docs/supabase/archive_tenant_billing.sql \
           docs/supabase/purge_archived_tenants.sql; do
    $P -d $DB -f "$f"
  done
done
$P -d $DB -f $D/10_scenarios.sql
echo "archive_billing: all scenarios passed"
