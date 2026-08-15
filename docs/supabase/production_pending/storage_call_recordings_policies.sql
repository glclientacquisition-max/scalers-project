-- PRODUCTION PENDING — DO NOT APPLY WITHOUT EXPLICIT HUMAN APPROVAL
-- Project: ALCR (fjxcdccgyhnvnnlnovcl)
-- See: docs/storage/STORAGE_SECURITY_MODEL.md
--
-- PROPOSED policies derived from current application behavior (Phase 3G).
-- Historical production policy state: UNKNOWN.
--
-- Current behavior:
--   - Voice engine uploads via service_role (bypasses Storage RLS)
--   - Signed URLs stored in calls.recording_url (7-day TTL at upload)
--   - Desk and Gemini Scan fetch recording_url via HTTP (signed URL)
--
-- These policies add defense-in-depth for authenticated owner read
-- on objects under their tenant call paths. service_role unchanged.

-- Ensure bucket exists (no-op if present)
insert into storage.buckets (id, name, public)
values ('call-recordings', 'call-recordings', false)
on conflict (id) do update set public = false;

-- service_role: full access (voice upload, admin)
drop policy if exists "call_recordings_service_role_all" on storage.objects;
create policy "call_recordings_service_role_all"
  on storage.objects
  for all
  to service_role
  using (bucket_id = 'call-recordings')
  with check (bucket_id = 'call-recordings');

-- authenticated: read objects for calls in member tenants
-- Path convention: {call_sid}/{recording_sid}.ext (see src/db.js uploadRecordingBuffer)
drop policy if exists "call_recordings_authenticated_select" on storage.objects;
create policy "call_recordings_authenticated_select"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'call-recordings'
    and exists (
      select 1
      from public.calls c
      where c.sautikit_call_sid = split_part(name, '/', 1)
        and c.tenant_id in (select public.current_user_tenant_ids())
    )
  );

-- No authenticated insert/update/delete — uploads remain service_role only.
