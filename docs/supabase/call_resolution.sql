-- call_resolution.sql
-- Purpose: Persist AI assist outcome per call for retail (and later vertical) metrics.
-- Run after: lead_status.sql (and lead_status_archive.sql if applied)
--
-- resolution: resolved | needs_human | abandoned | unresolved | unknown
-- primary_intent: hours | location | price | availability | order | ...
-- resolution_note: short free text (e.g. hold saved, escalate failed)

alter table public.calls
  add column if not exists resolution text not null default 'unknown';

alter table public.calls
  add column if not exists primary_intent text;

alter table public.calls
  add column if not exists resolution_note text;

do $do$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'calls_resolution_check'
  ) then
    alter table public.calls
      add constraint calls_resolution_check
      check (
        resolution in (
          'resolved',
          'needs_human',
          'abandoned',
          'unresolved',
          'unknown'
        )
      );
  end if;
end
$do$;

comment on column public.calls.resolution is
  'AI assist outcome: resolved | needs_human | abandoned | unresolved | unknown';
comment on column public.calls.primary_intent is
  'Best-effort primary caller intent from the live Brain state.';
comment on column public.calls.resolution_note is
  'Short note about how the call ended (hold saved, escalate, etc.).';

-- Owners may update resolution fields for manual correction (column-scoped with lead_status).
revoke update on public.calls from authenticated;
grant update (lead_status, resolution, primary_intent, resolution_note) on public.calls to authenticated;
