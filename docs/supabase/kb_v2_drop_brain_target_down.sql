-- Rollback for kb_v2_drop_brain_target.sql (2026-10-28.5): restores tenants.brain_target exactly as kb_v2.sql made it.
-- Every business comes back as 'v2' (the old 'v1' hold no longer exists in code; values are not recoverable).
alter table public.tenants add column if not exists brain_target text not null default 'v2';
do $$ begin
  alter table public.tenants add constraint tenants_brain_target check (brain_target in ('v1', 'v2'));
exception when duplicate_object then null; end $$;
comment on column public.tenants.brain_target is 'Retired (P2). Restored by rollback only; nothing reads it.';
