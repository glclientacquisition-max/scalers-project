-- E.164 phone backfill (Kenya local formats only). Needs 20261011200000_structured_data_foundation (to_e164_ke, is_e164).
-- Run step 1 (dry run) first; run step 2 only with owner approval, after a backup export.
-- Never touches a number to_e164_ke can't read (left for the data-quality report).

-- 1. DRY RUN: what would change (counts only, no numbers printed).
select 'alerts' as field, count(*) filter (where not is_e164(whatsapp_notification_number) and to_e164_ke(whatsapp_notification_number) is not null) as fixable,
       count(*) filter (where coalesce(whatsapp_notification_number, '') not in ('', 'pending') and to_e164_ke(whatsapp_notification_number) is null) as unreadable
  from tenants
union all
select 'team_directory', count(*) filter (where not is_e164(m->>'phone') and to_e164_ke(m->>'phone') is not null),
       count(*) filter (where coalesce(m->>'phone', '') <> '' and to_e164_ke(m->>'phone') is null)
  from tenants, jsonb_array_elements(case when jsonb_typeof(team_directory) = 'array' then team_directory else '[]' end) m
union all
select 'contacts', count(*) filter (where not is_e164(phone) and to_e164_ke(phone) is not null),
       count(*) filter (where coalesce(phone, '') <> '' and to_e164_ke(phone) is null)
  from contacts
union all
select 'contacts_would_collide', count(*), 0
  from contacts a join contacts b on a.tenant_id = b.tenant_id and a.id <> b.id and to_e164_ke(a.phone) = b.phone
 where not is_e164(a.phone);

-- 2. APPLY (one transaction).
begin;
update tenants
   set whatsapp_notification_number = to_e164_ke(whatsapp_notification_number)
 where not is_e164(whatsapp_notification_number) and to_e164_ke(whatsapp_notification_number) is not null;

update tenants t
   set team_directory = (
     select jsonb_agg(case when jsonb_typeof(m) = 'object' and not is_e164(m->>'phone') and to_e164_ke(m->>'phone') is not null
                           then m || jsonb_build_object('phone', to_e164_ke(m->>'phone')) else m end order by ord)
       from jsonb_array_elements(t.team_directory) with ordinality as x(m, ord))
 where jsonb_typeof(t.team_directory) = 'array'
   and exists (select 1 from jsonb_array_elements(t.team_directory) m where not is_e164(m->>'phone') and to_e164_ke(m->>'phone') is not null);

-- Contacts: skip any row whose E.164 form already exists for that tenant (merge those by hand in the desk).
update contacts a
   set phone = to_e164_ke(a.phone)
 where not is_e164(a.phone) and to_e164_ke(a.phone) is not null
   and not exists (select 1 from contacts b where b.tenant_id = a.tenant_id and b.id <> a.id and b.phone = to_e164_ke(a.phone));
commit;
