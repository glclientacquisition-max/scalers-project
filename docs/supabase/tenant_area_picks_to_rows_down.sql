-- Restore v0 tenant_area_picks after tenant_area_picks_to_rows.sql.
-- Drops row-shaped data written after cutover. Keeps tenant_area_picks_v0 intact.
-- Single transaction.

begin;

do $down$
begin
  if not exists (
    select 1
    from information_schema.tables
    where table_schema = 'public'
      and table_name = 'tenant_area_picks_v0'
  ) then
    raise exception 'tenant_area_picks_v0 not found; nothing to restore';
  end if;
end $down$;

drop table if exists public.tenant_area_picks;

alter table public.tenant_area_picks_v0 rename to tenant_area_picks;

commit;
