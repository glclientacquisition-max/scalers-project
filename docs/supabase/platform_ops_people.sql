-- People we escalate to. Name, phone, email.
-- Additive on platform_ops_settings. Service role only.

alter table public.platform_ops_settings
  add column if not exists people jsonb not null default '[]'::jsonb;

comment on column public.platform_ops_settings.people is
  'Escalate people: [{id, name, phone, email}]. emails[] stays in sync for mail.';

update public.platform_ops_settings
set people = coalesce((
  select jsonb_agg(jsonb_build_object(
    'id', e,
    'name', split_part(e, '@', 1),
    'phone', '',
    'email', e
  ))
  from unnest(emails) as e
), '[]'::jsonb)
where coalesce(jsonb_array_length(people), 0) = 0
  and cardinality(emails) > 0;
