-- Three features review fixes (call facts, owner corrections, Updates).
-- Safe to re-run. Staging first; production only after the user's OK (backup, then migration, then merge).

-- 1. Callbacks only: Scalers never puts a caller through. Old "transferred" outcomes are callbacks.
update public.call_facts set outcome = 'callback', updated_at = now() where outcome = 'transferred';
update public.call_facts
  set review_snapshot = jsonb_set(review_snapshot, '{outcome}', '"callback"')
  where review_snapshot->>'outcome' = 'transferred';
alter table public.call_facts drop constraint if exists call_facts_outcome_check;
alter table public.call_facts add constraint call_facts_outcome_check
  check (outcome is null or outcome in ('sale_or_order','hold','booking','callback','info_only','lost','abandoned'));

-- 2. Owner correction also updates the call's intent and resolution, so the Inbox and the card agree.
create or replace function public.correct_call_facts(p_call uuid, p_intent text, p_outcome text, p_lost_reason text)
returns public.call_facts language plpgsql security definer set search_path = public as $$
declare
  v_tenant uuid; r public.call_facts;
begin
  select tenant_id into v_tenant from public.calls where id = p_call;
  if v_tenant is null then raise exception 'call not found' using errcode = 'P0002'; end if;
  if not public.member_can_write(v_tenant) then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_outcome = 'transferred' then p_outcome := 'callback'; end if;
  if p_outcome is distinct from 'lost' then p_lost_reason := null; end if;
  insert into public.call_facts (call_id, tenant_id, intent, outcome, lost_reason, source, owner_corrected_by, owner_corrected_at)
  values (p_call, v_tenant, p_intent, p_outcome, p_lost_reason, 'owner', auth.uid(), now())
  on conflict (call_id) do update set
    review_snapshot = case when call_facts.source = 'owner' then call_facts.review_snapshot
      else jsonb_build_object('intent', call_facts.intent, 'outcome', call_facts.outcome, 'lost_reason', call_facts.lost_reason, 'source', call_facts.source) end,
    intent = excluded.intent, outcome = excluded.outcome, lost_reason = excluded.lost_reason,
    source = 'owner', owner_corrected_by = auth.uid(), owner_corrected_at = now(), updated_at = now()
  returning * into r;

  -- Mirror onto the call row in the older vocabulary the Inbox, triage and contacts read.
  update public.calls set
    primary_intent = case p_intent
      when 'price_check' then 'price' when 'quote_request' then 'price'
      when 'availability' then 'availability'
      when 'product_info' then 'product_inquiry'
      when 'order_place' then 'order_enquiry' when 'order_status' then 'order_enquiry'
      when 'hold_or_pickup' then 'hold_or_pickup'
      when 'book_visit' then 'book_visit'
      when 'directions' then 'directions'
      when 'hours' then 'hours_open'
      when 'complaint' then 'complaint' when 'return_refund' then 'complaint' when 'warranty' then 'complaint'
      when 'emergency' then 'emergency'
      when 'human_request' then 'human'
      when 'general_enquiry' then 'general_enquiry'
      when 'delivery_question' then 'general_enquiry' when 'payment_question' then 'general_enquiry'
      else 'other' end,
    resolution = case p_outcome
      when 'callback' then 'needs_human'
      when 'abandoned' then 'abandoned'
      when 'lost' then 'unresolved'
      else 'resolved' end
  where id = p_call;
  return r;
end $$;
revoke all on function public.correct_call_facts(uuid, text, text, text) from public, anon;
grant execute on function public.correct_call_facts(uuid, text, text, text) to authenticated;

-- 3. Updates: save only if nobody changed them since we read them (two people posting at once).
-- security invoker: the caller's own RLS and column grant on tenants.daily_bulletin apply.
create or replace function public.save_daily_bulletin(p_tenant uuid, p_expected jsonb, p_next jsonb)
returns boolean language plpgsql security invoker set search_path = public as $$
declare
  v_hit int;
begin
  if jsonb_typeof(p_next) is distinct from 'array' then raise exception 'updates must be a list' using errcode = '22023'; end if;
  update public.tenants set daily_bulletin = p_next
    where id = p_tenant and coalesce(daily_bulletin, '[]'::jsonb) = coalesce(p_expected, '[]'::jsonb);
  get diagnostics v_hit = row_count;
  return v_hit = 1;
end $$;
revoke all on function public.save_daily_bulletin(uuid, jsonb, jsonb) from public, anon;
grant execute on function public.save_daily_bulletin(uuid, jsonb, jsonb) to authenticated;
