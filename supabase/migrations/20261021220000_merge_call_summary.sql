-- merge_call_summary(p_sid, p_patch): merge a JSON patch into calls.summary in
-- one UPDATE. Voice (VOICE_QUERY_BATCHING, src/db.js mergeCallSummaryMeta and
-- saveCallerInfo) calls it instead of getCall + rewrite, which re-read calls.*
-- by sid about 14 times per call and raced concurrent merges (last writer
-- wins on calls.summary). N+1 audit 21 Oct 2026, item #3.
--
-- NOT APPLIED. Platform reviews and applies: staging first; production waits
-- for the owner's OK. Until it exists Voice keeps the read-then-write path
-- (the RPC is re-probed once a minute).
--
-- calls.summary is text holding a JSON object (docs/supabase/foundation_bootstrap.sql).
-- Same reading rules as src/db.js parseSummary: null or '' -> {}; a JSON
-- object -> itself; anything else (plain text, invalid JSON, a JSON scalar or
-- array) -> {"text": <original>}. Keys in the patch overwrite; a JSON null
-- in the patch stores null (the JS merge does the same). Keys are stored in
-- jsonb order, not insertion order; every reader parses the JSON.
--
-- ADDITIVE. Safe to re-run.
-- Rollback:
--   drop function if exists public.merge_call_summary(text, jsonb);
--   drop function if exists public.call_summary_jsonb(text);

create or replace function public.call_summary_jsonb(p_summary text)
returns jsonb
language plpgsql
immutable
set search_path = public
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

create or replace function public.merge_call_summary(p_sid text, p_patch jsonb)
returns setof public.calls
language plpgsql
security invoker
set search_path = public
as $$
begin
  if p_sid is null or btrim(p_sid) = '' then
    return;
  end if;
  return query
    update public.calls c
       set summary = (
         public.call_summary_jsonb(c.summary)
         || case when jsonb_typeof(p_patch) = 'object' then p_patch else '{}'::jsonb end
       )::text
     where c.sautikit_call_sid = p_sid
    returning c.*;
end;
$$;

comment on function public.merge_call_summary(text, jsonb) is
  'Voice: calls.summary = summary::jsonb || patch in one UPDATE (no read-then-write). Returns the updated row; no row when the sid is unknown.';

-- Service role only (the voice engine). No anon or signed-in caller.
revoke all on function public.call_summary_jsonb(text) from public, anon, authenticated;
revoke all on function public.merge_call_summary(text, jsonb) from public, anon, authenticated;
grant execute on function public.call_summary_jsonb(text) to service_role;
grant execute on function public.merge_call_summary(text, jsonb) to service_role;
