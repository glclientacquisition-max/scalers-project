-- Call recording retention (platform default + per-business override).
-- Nullable columns; safe to apply when ready. Not applied by agents.

alter table public.platform_ops_settings
  add column if not exists recording_retention_days integer
  check (
    recording_retention_days is null
    or recording_retention_days = -1
    or (recording_retention_days >= 7 and recording_retention_days <= 365)
  );

comment on column public.platform_ops_settings.recording_retention_days is
  'Days before call recordings are purged. null = use RECORDING_RETENTION_DAYS env (default 30). -1 = never delete.';

alter table public.tenants
  add column if not exists recording_retention_days_override integer
  check (
    recording_retention_days_override is null
    or recording_retention_days_override = -1
    or (recording_retention_days_override >= 7 and recording_retention_days_override <= 365)
  );

comment on column public.tenants.recording_retention_days_override is
  'Super Admin only. null = platform default. -1 = never delete for this business.';
