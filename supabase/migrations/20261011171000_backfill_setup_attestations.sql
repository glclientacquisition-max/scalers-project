-- Workspaces finished through the new setup flow before it attested identity + tools.
-- Only rows where setup itself already wrote the owner's agent-name confirmation.
-- Applied to staging (sgcdncjxauhsbunobmob) 11 Oct 2026.
insert into public.tenant_field_meta (tenant_id, field_path, source, confirmed_by, confirmed_at, updated_at)
select m.tenant_id, p.path, 'owner', m.confirmed_by, coalesce(m.confirmed_at, now()), now()
  from public.tenant_field_meta m
  join public.tenants t on t.id = m.tenant_id and t.setup_completed_at is not null and t.onboarding_step >= 5
  cross join (values ('identity.business_name'), ('identity.language'), ('assistant.tools')) as p(path)
 where m.field_path = 'assistant.agent_name' and m.source = 'owner'
on conflict do nothing;
