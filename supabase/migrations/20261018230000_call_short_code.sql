-- Short call link: calls.short_code for app.scalers.co.ke/c/<code>.
-- Run after: supabase/migrations/20261018220000_revoke_anon_accept_transfer.sql
--
-- Staff call-alert SMS (#777, src/notifications/templates.js renderStaffSms)
-- end with app.scalers.co.ke/c/<code>. The Desk route /c/[code] signs the
-- person in, checks they are a member of the call's tenant, and opens
-- /calls/<id>. Until this file is applied, the SMS goes out without a link.
--
-- Code: 7 random characters from 23456789ABCDEFGHJKMNPQRSTUVWXYZ (no 0/O/1/I/L).
-- Random bytes (gen_random_uuid), never derived from the call id. 31^7 = 27.5e9.
-- New rows get a code from a BEFORE INSERT trigger; existing rows are backfilled.
-- Idempotent: safe to run twice.
--
-- Staging first. Production waits for the owner's OK. Same statements.
-- Rows at authoring time (18 Oct 2026): staging 887, production 320. No other
-- triggers on public.calls.

alter table public.calls add column if not exists short_code text;

create or replace function public.call_short_code_random(p_len integer default 7)
returns text
language plpgsql
volatile
set search_path = pg_catalog, public
as $$
declare
  alphabet constant text := '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  -- uuid v4 bytes 0-5 and 9-15 are random (6 and 8 carry version bits).
  idx constant integer[] := array[0, 1, 2, 3, 4, 5, 9, 10, 11, 12, 13, 14, 15];
  b bytea := uuid_send(gen_random_uuid());
  n integer := least(greatest(coalesce(p_len, 7), 6), 8);
  code_out text := '';
begin
  for i in 1..n loop
    code_out := code_out || substr(alphabet, (get_byte(b, idx[i]) % 31) + 1, 1);
  end loop;
  return code_out;
end;
$$;

create or replace function public.call_short_code_new()
returns text
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
declare
  candidate text;
  tries integer := 0;
begin
  loop
    tries := tries + 1;
    -- After 5 clashes (practically never), step up to 8 characters.
    candidate := public.call_short_code_random(case when tries > 5 then 8 else 7 end);
    exit when not exists (select 1 from public.calls c where c.short_code = candidate);
    if tries >= 20 then
      raise exception 'call_short_code_new: no free code after % tries', tries;
    end if;
  end loop;
  return candidate;
end;
$$;

create or replace function public.calls_set_short_code()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if new.short_code is null then
    new.short_code := public.call_short_code_new();
  end if;
  return new;
end;
$$;

-- Internal helpers: no direct callers.
revoke all on function public.call_short_code_random(integer) from public, anon, authenticated;
revoke all on function public.call_short_code_new() from public, anon, authenticated;
revoke all on function public.calls_set_short_code() from public, anon, authenticated;
grant execute on function public.call_short_code_random(integer) to service_role;
grant execute on function public.call_short_code_new() to service_role;

drop trigger if exists calls_set_short_code on public.calls;
create trigger calls_set_short_code
  before insert on public.calls
  for each row execute function public.calls_set_short_code();

-- Backfill existing rows one by one (each code checked against the table).
do $$
declare
  r record;
begin
  for r in select id from public.calls where short_code is null loop
    update public.calls set short_code = public.call_short_code_new() where id = r.id;
  end loop;
end;
$$;

create unique index if not exists calls_short_code_key on public.calls (short_code);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.calls'::regclass and conname = 'calls_short_code_format'
  ) then
    alter table public.calls
      add constraint calls_short_code_format
      check (short_code is null or short_code ~ '^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6,8}$');
  end if;
end;
$$;

comment on column public.calls.short_code is
  'Random 6-8 char code for the staff SMS link app.scalers.co.ke/c/<code>. Not derived from id.';
