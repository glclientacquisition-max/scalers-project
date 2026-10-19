#!/bin/bash
# Throwaway local Postgres proof for the billing P1–P14 apply order.
# Never point this at Supabase. Production is refused by the script's database name.
set -euo pipefail
cd "$(dirname "$0")/../../.."
DB=billing_apply_order_proof
PSQL="sudo -u postgres psql -v ON_ERROR_STOP=1 -q"

$PSQL -c "drop database if exists $DB" -c "create database $DB"
$PSQL -d "$DB" -f tests/sql/billing_data_layer/00_stub_schema.sql
$PSQL -d "$DB" -f tests/sql/owner_billing_actions/00_extra_stub.sql
echo "P1 billing_data_layer.sql"
$PSQL -d "$DB" -f docs/supabase/billing_data_layer.sql
echo "P2 billing_status not null"
$PSQL -d "$DB" -f docs/supabase/billing_data_layer_billing_status_not_null.sql
echo "P3+P4 owner_billing_actions.sql"
$PSQL -d "$DB" -f docs/supabase/owner_billing_actions.sql
echo "P5 invoice_pay.sql"
$PSQL -d "$DB" -f docs/supabase/invoice_pay.sql
echo "P6 invoice_documents.sql"
$PSQL -d "$DB" -f docs/supabase/invoice_documents.sql
echo "P7 package_version_editor.sql"
$PSQL -d "$DB" -f docs/supabase/package_version_editor.sql
echo "P8 billing_company.sql"
$PSQL -d "$DB" -f docs/supabase/billing_company.sql
echo "P9 invoice_pay_session.sql"
$PSQL -d "$DB" -f docs/supabase/invoice_pay_session.sql
$PSQL -d "$DB" -f docs/supabase/invoice_pay_session.sql
echo "P10 billing_mode_legal_pairs.sql"
$PSQL -d "$DB" -f docs/supabase/billing_mode_legal_pairs.sql
$PSQL -d "$DB" -f docs/supabase/billing_mode_legal_pairs.sql
echo "P11 invoice_pay_held.sql"
$PSQL -d "$DB" -f docs/supabase/invoice_pay_held.sql
$PSQL -d "$DB" -f docs/supabase/invoice_pay_held.sql
echo "P12 invoice_pay_collections.sql"
$PSQL -d "$DB" -f docs/supabase/invoice_pay_collections.sql
$PSQL -d "$DB" -f docs/supabase/invoice_pay_collections.sql
echo "P13 invoice_pay_checkout_total.sql"
$PSQL -d "$DB" -f docs/supabase/invoice_pay_checkout_total.sql
$PSQL -d "$DB" -f docs/supabase/invoice_pay_checkout_total.sql
echo "P14 invoice_pay_checkout_review.sql"
$PSQL -d "$DB" -f docs/supabase/invoice_pay_checkout_review.sql
$PSQL -d "$DB" -f docs/supabase/invoice_pay_checkout_review.sql
$PSQL -d "$DB" -c "select position('pending_unattached' in pg_get_indexdef('public.payment_attempts_one_pending_part'::regclass)) > 0 as session_index, position('checkout session is already parked' in pg_get_functiondef('public.park_invoice_pay_attempt(uuid,text,text,timestamptz)'::regprocedure)) > 0 as park_keeps, position('checkout_closed_at is null' in pg_get_functiondef('public.create_invoice_pay_attempt(text,numeric)'::regprocedure)) > 0 as held_until_closed, to_regprocedure('public.release_held_pay_checkout(uuid)') is not null as release_held, to_regprocedure('public.reconcile_checkout_collection(text,text,text,numeric,uuid,uuid,jsonb,integer,text,integer)') is not null as reconcile, position('billing stays off while the business is on beta' in pg_get_functiondef('public.set_tenant_billing_mode(uuid,text,text,text,timestamptz,boolean)'::regprocedure)) > 0 as legal_pairs;"
$PSQL -d "$DB" -c "do \$\$ begin if position('checkout_closed_at is null' in pg_get_functiondef('public.create_invoice_pay_attempt(text,numeric)'::regprocedure)) = 0 or to_regprocedure('public.reconcile_checkout_collection(text,text,text,numeric,uuid,uuid,jsonb,integer,text,integer)') is null then raise exception 'P12 did not land'; end if; if to_regprocedure('public.reconcile_checkout_total(text,text,numeric,uuid,uuid,jsonb,integer,text,integer)') is null or position('collected_total_seen_kes' in pg_get_functiondef('public.reconcile_checkout_total(text,text,numeric,uuid,uuid,jsonb,integer,text,integer)'::regprocedure)) = 0 then raise exception 'P13 did not land'; end if; if position('checkout total needs review' in pg_get_functiondef('public.create_invoice_pay_attempt(text,numeric)'::regprocedure)) = 0 or to_regprocedure('public.settle_checkout_reading(text,text,numeric,uuid,uuid,text,numeric,jsonb,integer,text,integer)') is null then raise exception 'P14 did not land'; end if; end \$\$;"
echo "proof"
$PSQL -d "$DB" -f tests/sql/billing_apply_order/proof.sql
echo "re-apply P1 finalize installer after P8"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
chmod a+rx "$WORK"
awk '/^-- finalize_invoice \(data-layer numbering\)/,/^\$install_finalize_invoice\$;/' docs/supabase/billing_data_layer.sql > "$WORK/p1_finalize.sql"
chmod a+r "$WORK/p1_finalize.sql"
$PSQL -d "$DB" -f "$WORK/p1_finalize.sql"
$PSQL -d "$DB" -c "select position('SCL-' in pg_get_functiondef('public.finalize_invoice(uuid)'::regprocedure)) > 0 as still_scl, position('scalers.billing_write' in pg_get_functiondef('public.finalize_invoice(uuid)'::regprocedure)) > 0 as still_flag, position('invoice-credit:' in pg_get_functiondef('public.finalize_invoice(uuid)'::regprocedure)) > 0 as still_credit;"
echo "billing apply order: ok"
