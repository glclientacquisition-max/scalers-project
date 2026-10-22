-- OPTIONAL BACKFILL for call_messages. NOT RUN by any migration or script.
-- Run by hand, staging first, only after call_messages.sql is applied and
-- only with a go (prod: Alvin's yes). Service role / SQL editor.
--
-- Copies past caller SMS from the notify_sends ledger into call_messages so
-- old calls show their texts in the Desk thread:
--   notify_sends rows with audience = 'caller', channel = 'sms', tenant set,
--   matched to a call by call_id, else by call_sid = calls.sautikit_call_sid
--   (rows Voice sent with only a call sid). Rows with no matching call, a
--   blank body (purged) or an unknown kind are skipped.
--
-- Mapping:
--   source          = kind with any ':<suffix>' removed (old Desk rows used
--                     'caller_inbox_reply:<uuid>'); must be a known caller kind
--   status          = notify_sends.status (pending | sent | failed | refused)
--   sent_at         = settled_at, else created_at, when sent
--   failed_at       = settled_at, else created_at, when failed/refused
--   failure_reason  = failure_reason, else the prod-only 'error' column (read
--                     via to_jsonb so this also runs where 'error' is absent)
--   author_kind     = 'owner' for caller_note / caller_inbox_reply,
--                     'assistant' when the row has a call_sid (Voice),
--                     else 'system'; author_user_id stays null (not in ledger)
--   phone           = recipient normalised to 254... (else null)
--   contact_id      = tenant contact with that phone
--   body            = first 1600 characters
--   created_at      = notify_sends.created_at (thread order)
--   idempotency_key = notify_sends.idempotency_key; notify_send_id = its id
-- Re-runnable: rows already linked or with the same key are skipped.
--
-- Dry run first (counts only):
--   select count(*) from (<the select below>) x;

insert into public.call_messages (
  created_at, tenant_id, call_id, contact_id, phone, direction, body, status,
  failure_reason, author_kind, source, idempotency_key, notify_send_id,
  provider_message_id, sent_at, failed_at
)
select
  n.created_at,
  n.tenant_id,
  c.id,
  ct.id,
  p.phone,
  'out',
  left(n.body, 1600),
  n.status,
  left(coalesce(n.failure_reason, to_jsonb(n) ->> 'error'), 200),
  case
    when k.source in ('caller_note', 'caller_inbox_reply') then 'owner'
    when n.call_sid is not null then 'assistant'
    else 'system'
  end,
  k.source,
  n.idempotency_key,
  n.id,
  n.provider_message_id,
  case when n.status = 'sent' then coalesce(n.settled_at, n.created_at) end,
  case when n.status in ('failed', 'refused') then coalesce(n.settled_at, n.created_at) end
from public.notify_sends n
cross join lateral (select split_part(n.kind, ':', 1) as source) k
cross join lateral (select public._call_messages_ke_phone(n.recipient) as phone) p
join lateral (
  select c.id
  from public.calls c
  where c.tenant_id = n.tenant_id
    and (c.id = n.call_id
         or (n.call_id is null and n.call_sid is not null and c.sautikit_call_sid = n.call_sid))
  order by (c.id = n.call_id) desc, c.created_at desc
  limit 1
) c on true
left join lateral (
  select x.id
  from public.contacts x
  where p.phone is not null
    and x.tenant_id = n.tenant_id
    and x.phone in (p.phone, '+' || p.phone, '0' || substr(p.phone, 4))
  order by x.updated_at desc nulls last
  limit 1
) ct on true
where n.audience = 'caller'
  and n.channel = 'sms'
  and n.tenant_id is not null
  and n.body is not null
  and btrim(n.body) <> ''
  and k.source in (
    'caller_note', 'caller_inbox_reply', 'caller_callback',
    'caller_appointment', 'caller_appointment_confirmed',
    'caller_appointment_cancelled', 'caller_appointment_rescheduled',
    'caller_hold', 'caller_hold_updated', 'caller_hold_ready',
    'caller_hold_cancelled', 'caller_order', 'missed_textback')
  and not exists (select 1 from public.call_messages m where m.notify_send_id = n.id)
  and not exists (select 1 from public.call_messages m
                  where m.tenant_id = n.tenant_id and m.idempotency_key = n.idempotency_key)
on conflict do nothing;

-- Undo (removes only backfilled rows; Desk-recorded rows keep author_user_id
-- or were recorded after the cut-off you pick):
--   delete from public.call_messages m
--    where m.notify_send_id is not null and m.author_user_id is null
--      and m.created_at < '<time the backfill ran>';
