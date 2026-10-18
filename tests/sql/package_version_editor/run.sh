#!/bin/bash
# Throwaway local Postgres check for package_version_editor.sql.
# Applies the billing data layer, then the editor twice (re-run safety).
# Never point this at Supabase.
set -euo pipefail
cd "$(dirname "$0")/../../.."
DB=package_version_editor_test
PSQL="sudo -u postgres psql -v ON_ERROR_STOP=1 -q"
$PSQL -c "drop database if exists $DB" -c "create database $DB"
$PSQL -d "$DB" -f tests/sql/billing_data_layer/00_stub_schema.sql
$PSQL -d "$DB" -f tests/sql/billing_data_layer/05_legacy.sql
$PSQL -d "$DB" -f docs/supabase/billing_data_layer.sql
for pass in 1 2; do
  $PSQL -d "$DB" -f docs/supabase/package_version_editor.sql
done
$PSQL -d "$DB" -f tests/sql/package_version_editor/10_scenarios.sql
# Owner prices, twice: the second apply must not publish another version.
for pass in 1 2; do
  $PSQL -d "$DB" -f docs/supabase/package_version_owner_prices.sql
done
echo "package_version_editor sql: ok"
