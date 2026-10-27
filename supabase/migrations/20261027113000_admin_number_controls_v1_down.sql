-- Rollback for 20261027113000_admin_number_controls_v1.sql. Drops functions
-- only; pool rows and tenants are left as they are. Audit rows stay.
drop function if exists public.admin_move_number(text, uuid, uuid, text, text, boolean);
drop function if exists public.admin_lift_quarantine(text, text, text, boolean);
drop function if exists public.admin_restore_business_number(uuid, text, text, boolean, text);
drop function if exists public._admin_did_assert_no_other_holder(text, uuid[]);
drop function if exists public._admin_did_pool_state(uuid);
drop function if exists public._admin_did_tenant_state(uuid);
drop function if exists public._admin_did_refuse_protected(text);
drop function if exists public._admin_did_is_protected(text);
drop function if exists public._admin_did_last9(text);
