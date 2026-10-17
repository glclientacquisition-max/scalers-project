-- Inbox and Overview read the newest calls per tenant: where tenant_id = $1 order by created_at desc limit N.
-- The only tenant-leading index on calls also sorts by inbox_pinned_at first, so the planner sorts the
-- whole tenant's rows. This index serves the read directly.
create index if not exists calls_tenant_created_idx on public.calls (tenant_id, created_at desc);
