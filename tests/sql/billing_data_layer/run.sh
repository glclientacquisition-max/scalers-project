#!/bin/bash
# Throwaway local Postgres check for billing_data_layer.sql.
# Applies the real SQL twice (re-run safety), then runs the scenarios.
# Never point this at Supabase.
set -euo pipefail
cd "$(dirname "$0")/../../.."
DB=billing_data_layer_test
PSQL="sudo -u postgres psql -v ON_ERROR_STOP=1 -q"
$PSQL -c "drop database if exists $DB" -c "create database $DB"
$PSQL -d "$DB" -f tests/sql/billing_data_layer/00_stub_schema.sql
$PSQL -d "$DB" -f tests/sql/billing_data_layer/05_legacy.sql
for pass in 1 2; do
  $PSQL -d "$DB" -f docs/supabase/billing_data_layer.sql
done
$PSQL -d "$DB" -f tests/sql/billing_data_layer/10_scenarios.sql
echo "billing_data_layer sql: ok"
