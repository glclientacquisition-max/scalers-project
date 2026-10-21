-- Record the owner's reply to a caller on calls.summary, without giving
-- clients UPDATE on calls.summary. Desk (dashboard noteActions.ts) calls
-- this after the caller SMS has gone out, so the call page can show
-- "you replied".
-- Run after inbox_archive_cascade.sql (it reuses _inbox_archive_assert_writer).
--
-- calls.summary is TEXT holding a JSON object (staging checked 2026-10-22).
-- One UPDATE statement reads the current row value, merges only
--   caller_reply_body = p_body
--   caller_reply_at   = now()   (timestamptz as JSON, e.g. "2026-10-22T01:40:00.123+00:00")
-- and writes it back as text, so other keys and concurrent writers of other
-- keys are kept (no read in the app, no whole-object overwrite).
--
-- How the existing text is read (_calls_summary_object), same rule as the
-- dashboard's parseSummary():
--   null, '' or only spaces      -> {}
--   a JSON object                -> that object
--   anything else (not JSON, or JSON array / string / number) -> {"text": <original text>}
-- So nothing already in summary is lost: non-object text is kept verbatim
-- under "text", which is where the Desk reader already shows it.
--
-- Body rule: null, empty or only spaces -> 22023 'body required'.
-- Longer than 1600 characters -> 22023 'body too long' (rejected, not
-- truncated, so Desk never shows a reply different from the SMS sent).
-- The body is stored as given (not trimmed).
--
-- Adds:
--   _calls_summary_object(p_summary text) returns jsonb (immutable helper, no client grants)
--   calls_record_caller_reply(p_tenant_id uuid, p_call_id uuid, p_body text)
--     returns jsonb {"at": timestamptz}
--
-- Errors: 42501 'not allowed' (anon, viewer, non-member), 22023 (null tenant,
-- null call id, bad body), P0002 'call not found' (no such call in
-- p_tenant_id, including another tenant's call).
--
-- ADDITIVE. ASCII-only. Safe to re-run.
--
-- Rollback (in this order):
--   drop function if exists public.calls_record_caller_reply(uuid, uuid, text);
--   drop function if exists public._calls_summary_object(text);

create or replace function public._calls_summary_object(p_summary text)
returns jsonb
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  v jsonb;
begin
  if p_summary is null or btrim(p_summary) = '' then
    return '{}'::jsonb;
  end if;
  begin
    v := p_summary::jsonb;
  exception when others then
    return jsonb_build_object('text', p_summary);
  end;
  if jsonb_typeof(v) = 'object' then
    return v;
  end if;
  return jsonb_build_object('text', p_summary);
end;
$$;

revoke all on function public._calls_summary_object(text) from public, anon, authenticated;

create or replace function public.calls_record_caller_reply(
  p_tenant_id uuid,
  p_call_id uuid,
  p_body text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_at timestamptz := now();
  v_id uuid;
begin
  perform public._inbox_archive_assert_writer(p_tenant_id);

  if p_call_id is null then
    raise exception 'call id required' using errcode = '22023';
  end if;
  if p_body is null or btrim(p_body) = '' then
    raise exception 'body required' using errcode = '22023';
  end if;
  if char_length(p_body) > 1600 then
    raise exception 'body too long (max 1600, got %)', char_length(p_body)
      using errcode = '22023';
  end if;

  update public.calls c
     set summary = (
       public._calls_summary_object(c.summary)
       || jsonb_build_object('caller_reply_body', p_body, 'caller_reply_at', v_at)
     )::text
   where c.id = p_call_id
     and c.tenant_id = p_tenant_id
  returning c.id into v_id;

  if v_id is null then
    raise exception 'call not found' using errcode = 'P0002';
  end if;

  return jsonb_build_object('at', v_at);
end;
$$;

revoke all on function public.calls_record_caller_reply(uuid, uuid, text) from public, anon;
grant execute on function public.calls_record_caller_reply(uuid, uuid, text) to authenticated, service_role;
