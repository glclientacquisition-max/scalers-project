#!/bin/bash
# Throwaway local Postgres check for owner_billing_actions.sql.
# Applies the billing data layer, then the owner file twice. Never point this at Supabase.
set -euo pipefail
cd "$(dirname "$0")/../../.."
DB=owner_billing_actions_test
PSQL="sudo -u postgres psql -v ON_ERROR_STOP=1 -q"
$PSQL -c "drop database if exists $DB" -c "create database $DB"
$PSQL -d "$DB" -f tests/sql/billing_data_layer/00_stub_schema.sql
$PSQL -d "$DB" -f tests/sql/owner_billing_actions/00_extra_stub.sql
$PSQL -d "$DB" -f docs/supabase/billing_data_layer.sql
for pass in 1 2; do
  $PSQL -d "$DB" -f docs/supabase/owner_billing_actions.sql
done
$PSQL -d "$DB" -f tests/sql/owner_billing_actions/10_scenarios.sql
echo "owner_billing_actions sql: ok"
