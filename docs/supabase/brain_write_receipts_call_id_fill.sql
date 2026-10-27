-- PLATFORM TO APPLY (optional, staging first). Brain does not run this. Not a migration file.
-- Why: brain_write_receipts.call_id is a calls.id uuid, but the voice path only knows the call SID, so
-- older receipts landed with call_id = null. The BRAIN_ENGINES path now resolves calls.id from the SID
-- before writing (src/conversation/v2/liveHandlers.js -> ctx.resolveCallId). This trigger is a belt-and-
-- braces fill for any writer that still passes only call_sid, plus a one-off backfill.
-- Safe to re-run. Read the backfill count first (SELECT below) before running the UPDATE.

create or replace function public.brain_write_receipts_fill_call_id()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.call_id is null and new.call_sid is not null then
    select c.id into new.call_id
    from public.calls c
    where c.sautikit_call_sid = new.call_sid
    order by c.created_at desc
    limit 1;
  end if;
  return new;
end;
$$;

drop trigger if exists brain_write_receipts_fill_call_id on public.brain_write_receipts;
create trigger brain_write_receipts_fill_call_id
  before insert on public.brain_write_receipts
  for each row execute function public.brain_write_receipts_fill_call_id();

-- Backfill check (read-only):
--   select count(*) from public.brain_write_receipts r
--   where r.call_id is null and r.call_sid is not null
--     and exists (select 1 from public.calls c where c.sautikit_call_sid = r.call_sid);
-- Backfill:
--   update public.brain_write_receipts r
--   set call_id = c.id
--   from public.calls c
--   where r.call_id is null and r.call_sid is not null and c.sautikit_call_sid = r.call_sid;
