-- Roll back tenant_area_picks_backfill.sql: remove rows that were never confirmed
-- and still match a moved_from backfill (audit only; legacy columns unchanged).
delete from public.tenant_area_picks
where confirmed_at is null
  and moved_from is not null
  and jsonb_array_length(moved_from) > 0;
