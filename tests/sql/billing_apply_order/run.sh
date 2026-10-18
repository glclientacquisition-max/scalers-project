#!/bin/bash
# Throwaway local Postgres proof for the billing P1–P8 apply order.
# Never point this at Supabase. Production is refused by the script's database name.
set -euo pipefail
cd "$(dirname "$0")/../../.."
DB=billing_apply_order_proof
PSQL="sudo -u postgres psql -v ON_ERROR_STOP=1 -q"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

git show origin/cursor/billing-data-layer-cc4b:tests/sql/billing_data_layer/00_stub_schema.sql > "$WORK/00_stub.sql"
git show origin/cursor/owner-billing-actions-5c64:tests/sql/owner_billing_actions/00_extra_stub.sql > "$WORK/00_extra.sql"
git show origin/cursor/billing-data-layer-cc4b:docs/supabase/billing_data_layer.sql > "$WORK/p1.sql"
git show origin/cursor/billing-data-layer-cc4b:docs/supabase/billing_data_layer_billing_status_not_null.sql > "$WORK/p2.sql"
git show origin/cursor/owner-billing-actions-5c64:docs/supabase/owner_billing_actions.sql > "$WORK/p4.sql"
git show origin/cursor/admin-package-versions-b52e:docs/supabase/package_version_editor.sql > "$WORK/p7.sql"
chmod a+rx "$WORK"
chmod a+r "$WORK"/*

$PSQL -c "drop database if exists $DB" -c "create database $DB"
$PSQL -d "$DB" -f "$WORK/00_stub.sql"
$PSQL -d "$DB" -f "$WORK/00_extra.sql"
echo "P1 billing_data_layer.sql"
$PSQL -d "$DB" -f "$WORK/p1.sql"
echo "P2 billing_status not null"
$PSQL -d "$DB" -f "$WORK/p2.sql"
echo "P3+P4 owner_billing_actions.sql"
$PSQL -d "$DB" -f "$WORK/p4.sql"
echo "P5 invoice_pay.sql"
$PSQL -d "$DB" -f docs/supabase/invoice_pay.sql
echo "P6 invoice_documents.sql"
$PSQL -d "$DB" -f docs/supabase/invoice_documents.sql
echo "P7 package_version_editor.sql"
$PSQL -d "$DB" -f "$WORK/p7.sql"
echo "P8 billing_company.sql"
$PSQL -d "$DB" -f docs/supabase/billing_company.sql
echo "proof"
$PSQL -d "$DB" -f tests/sql/billing_apply_order/proof.sql
echo "re-apply P1 finalize installer after P8"
awk '/^-- finalize_invoice \(data-layer numbering\)/,/^\$install_finalize_invoice\$;/' "$WORK/p1.sql" > "$WORK/p1_finalize.sql"
chmod a+r "$WORK/p1_finalize.sql"
$PSQL -d "$DB" -f "$WORK/p1_finalize.sql"
$PSQL -d "$DB" -c "select position('SCL-' in pg_get_functiondef('public.finalize_invoice(uuid)'::regprocedure)) > 0 as still_scl, position('scalers.billing_write' in pg_get_functiondef('public.finalize_invoice(uuid)'::regprocedure)) > 0 as still_flag, position('invoice-credit:' in pg_get_functiondef('public.finalize_invoice(uuid)'::regprocedure)) > 0 as still_credit;"
echo "billing apply order: ok"
