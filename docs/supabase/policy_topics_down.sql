-- policy_topics_down.sql
-- Rollback for policy_topics.sql. Drops set_policy_topic and puts policy_rules_valid back to
-- the 20261012090000_payments_policies_v2 body (six fixed topics, no custom mode, no note_sw cap).
-- Before running: remove rows the old check would reject, or the constraint stays valid only
-- for new writes. Find them with:
--   select id from tenants where business_policies->'rules' is not null
--   and (business_policies->'rules'->'returns'->>'mode' = 'custom' or business_policies->'rules'->'delivery'->>'mode' = 'custom');
-- DO NOT RUN on production fjxcdccgyhnvnnlnovcl.

drop function if exists public.set_policy_topic(uuid, text, jsonb, jsonb, text, text);

create or replace function public.policy_rules_valid(r jsonb)
returns boolean language sql immutable as $$
  select r is null or jsonb_typeof(r) = 'null' or (
    jsonb_typeof(r) = 'object'
    and not exists (
      select 1 from jsonb_object_keys(r) k
      where k not in ('returns', 'delivery', 'cancellation', 'booking_changes', 'no_show', 'warranty'))
    and not exists (
      select 1 from jsonb_each(r) e
      where jsonb_typeof(e.value) <> 'object' or coalesce(length(e.value->>'note'), 0) > 200)
    and (r->'returns' is null or coalesce(r->'returns'->>'mode', 'refund_or_exchange') in ('refund_or_exchange', 'exchange', 'store_credit', 'none'))
    and (r->'delivery' is null or coalesce(r->'delivery'->>'mode', 'deliver') in ('deliver', 'pickup_only'))
    and (r->'cancellation' is null or coalesce(r->'cancellation'->>'fee', 'none') in ('none', 'deposit_kept', 'flat'))
    and (r->'no_show' is null or coalesce(r->'no_show'->>'charge', 'none') in ('none', 'callout', 'deposit_kept'))
  );
$$;
