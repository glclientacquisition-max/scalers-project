-- policy_topics.sql
-- Policies screen (/settings/policies): per-topic partial saves and pluggable niches.
-- Not applied. Staging sgcdncjxauhsbunobmob first, only on Alvin's GO. Rollback: policy_topics_down.sql.
--
-- 1. policy_rules_valid: any topic key (a-z, 0-9, _; up to 40), so a new niche topic needs
--    no schema change. mode "custom" allowed on returns and delivery. note and note_sw <= 200.
-- 2. set_policy_topic: one UPDATE that touches only rules.<topic>, policy_lines.<topic>,
--    one legacy text key and its provenance. Two sections saved at once can't overwrite each other.

create or replace function public.policy_rules_valid(r jsonb)
returns boolean language sql immutable as $$
  select r is null or jsonb_typeof(r) = 'null' or (
    jsonb_typeof(r) = 'object'
    and not exists (select 1 from jsonb_object_keys(r) k where k !~ '^[a-z][a-z0-9_]{0,39}$')
    and not exists (
      select 1 from jsonb_each(r) e
      where jsonb_typeof(e.value) <> 'object'
         or coalesce(length(e.value->>'note'), 0) > 200
         or coalesce(length(e.value->>'note_sw'), 0) > 200)
    and (r->'returns' is null or coalesce(r->'returns'->>'mode', 'refund_or_exchange') in ('refund_or_exchange', 'exchange', 'store_credit', 'none', 'custom'))
    and (r->'delivery' is null or coalesce(r->'delivery'->>'mode', 'deliver') in ('deliver', 'pickup_only', 'custom'))
    and (r->'cancellation' is null or coalesce(r->'cancellation'->>'fee', 'none') in ('none', 'deposit_kept', 'flat'))
    and (r->'no_show' is null or coalesce(r->'no_show'->>'charge', 'none') in ('none', 'callout', 'deposit_kept'))
  );
$$;

create or replace function public.set_policy_topic(
  p_tenant_id uuid,
  p_topic text,
  p_rule jsonb,      -- null = Not set (remove)
  p_line jsonb,      -- {"en": "...", "sw": "..."} or null
  p_text_key text,   -- returns | delivery | cancellation | warranty | null
  p_text text
) returns void
language plpgsql security definer set search_path = public as $$
declare bp jsonb;
begin
  if p_topic !~ '^[a-z][a-z0-9_]{0,39}$' then raise exception 'bad topic %', p_topic; end if;
  if p_text_key is not null and p_text_key not in ('returns', 'delivery', 'cancellation', 'warranty') then
    raise exception 'bad text key %', p_text_key;
  end if;
  select coalesce(business_policies, '{}'::jsonb) into bp from tenants where id = p_tenant_id for update;
  if not found then raise exception 'tenant not found'; end if;
  if jsonb_typeof(bp->'rules') is distinct from 'object' then bp := jsonb_set(bp, '{rules}', '{}'::jsonb); end if;
  if jsonb_typeof(bp->'policy_lines') is distinct from 'object' then bp := jsonb_set(bp, '{policy_lines}', '{}'::jsonb); end if;
  bp := case when p_rule is null then bp #- array['rules', p_topic] else jsonb_set(bp, array['rules', p_topic], p_rule) end;
  bp := case when p_line is null then bp #- array['policy_lines', p_topic] else jsonb_set(bp, array['policy_lines', p_topic], p_line) end;
  if p_text_key is not null then
    bp := jsonb_set(bp, array[p_text_key], to_jsonb(left(coalesce(p_text, ''), 500)));
    if jsonb_typeof(bp->'provenance') is distinct from 'object' then bp := jsonb_set(bp, '{provenance}', '{}'::jsonb); end if;
    bp := jsonb_set(bp, array['provenance', p_text_key], '{"source": "owner", "confirmed": true}'::jsonb);
  end if;
  update tenants set business_policies = bp where id = p_tenant_id;
end;
$$;

revoke all on function public.set_policy_topic(uuid, text, jsonb, jsonb, text, text) from public, anon, authenticated;
grant execute on function public.set_policy_topic(uuid, text, jsonb, jsonb, text, text) to service_role;
