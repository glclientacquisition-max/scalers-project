# Tenant field provenance (GIGO BI P0)

Platform-owned sidecar for **who said a tenant fact is true**. Values stay on existing `tenants` columns; provenance lives in `tenant_field_meta` keyed by `field_path`.

SQL: [`docs/supabase/tenant_field_provenance.sql`](../supabase/tenant_field_provenance.sql)  
Field map: see GIGO BI P0 Platform field map (tenant columns / JSON leaves; no parallel domain tables).

## Apply

Run in Supabase SQL Editor **after** [`product_catalog_and_social.sql`](../supabase/product_catalog_and_social.sql). Do not apply to production ALCR until reviewed.

## field_path conventions

| Pattern | Example |
| --- | --- |
| Scalar column | `identity.business_name`, `identity.vertical`, `assistant.agent_name` |
| Policy key | `policies.returns`, `policies.delivery`, `policies.payment`, `policies.holds.allowed` |
| Hours (live) | `hours.weekly_grid` → `tenants.hours_schedule` |
| Catalog product leaf | `catalog.product.<sku_or_index>.name` |
| Catalog service leaf | `catalog.service.<index>.name` |
| FAQ row | `faqs.<index>` (status/source on the FAQ object in `tenants.faqs`) |
| Notify | `team.notify.whatsapp`, `team.notify.email` |

Prefer stable `sku` when present; otherwise index (rewrite-sensitive).

## Envelope rules

- **source:** `owner` \| `seed` \| `import` \| `inferred` \| `call_suggested`
- **Completeness weight:** owner 100%, import 50%, seed / inferred / call_suggested 0%
- **Missing meta** on a non-empty legacy field: transitional **50%** until bulk backfill (open decision: treat as owner vs seed)
- **ready_badge:** never true on seed-only identity meta; needs owner meta somewhere, catalog depth, notify target, and overall score threshold (see RPC)
- **Compile (Brain):** must emit only **owner** or **confirmed** values into `llm_system_prompt`. Seeds and unconfirmed imports belong in UNKNOWN. Compiler change is Brain-owned; Platform only documents the contract.

## FAQ migration (same SQL file)

Existing `{question, answer}` rows get `status=suggested`, `source=seed`. Rows already marked `golden` / `confirmed` without `source=owner` are demoted to `suggested`. **Default is seed for safety** (roadmap open decision #5 backfill).

## RPCs (stable names)

| RPC | Role |
| --- | --- |
| `upsert_tenant_field_meta(...)` | Tag or update provenance; appends history on source change |
| `confirm_tenant_field(tenant_id, field_path, user_id)` | Sets `source=owner`, confirmation timestamps |
| `tenant_completeness_score(tenant_id)` | `{ overall, domains, ready_badge, next_gaps }` |
| `tenant_hold_gate(tenant_id)` | `{ allowed, reasons[] }` for place_hold |

## Hold gate (Platform read model)

Allowed only when all hold:

1. Holds enabled in `business_policies` (`holds.allowed`, nested `holds`, or owner meta on `policies.holds.allowed`)
2. At least one **holdable** `product_catalog` row with **owner** meta on `catalog.product.<sku>.name`
3. Verified notify target: WhatsApp number + channel on, or alert email + channel on, or owner meta on `team.notify.whatsapp`

Brain consumes `tenant_hold_gate`; voice/tools should not promise holds when `allowed` is false.

## Thin clients

- Voice / jobs: `src/db.js` — `getTenantCompletenessScore`, `getTenantHoldGate`, `upsertTenantFieldMeta`, `confirmTenantField`
- Desk server: `dashboard/src/lib/tenantFieldProvenance.ts`

## Verify RPCs (staging)

```sql
-- Replace with a tenant id you own
select public.tenant_completeness_score('00000000-0000-0000-0000-000000000001'::uuid);
select public.tenant_hold_gate('00000000-0000-0000-0000-000000000001'::uuid);

select public.upsert_tenant_field_meta(
  '00000000-0000-0000-0000-000000000001'::uuid,
  'identity.business_name',
  'owner',
  'desk:settings',
  null,
  null,
  'smoke',
  null,
  null
);

-- FAQ demotion check: no golden without owner source
select count(*)
from public.tenants t,
     jsonb_array_elements(coalesce(t.faqs, '[]'::jsonb)) f
where lower(coalesce(f->>'status', '')) in ('golden', 'confirmed')
  and lower(coalesce(f->>'source', 'seed')) <> 'owner';
```

Expect the FAQ query to return **0** after migration.

## Retail import → recompile

`applyCatalogImportAction` saves `product_catalog` only. After owner confirms an import diff, Desk should call `recompileAfterCatalogImport` in `dashboard/src/lib/catalogImportRecompile.ts` (Platform hook; wiring is Desk-owned).

## Blockers / open decisions

1. **Bulk backfill:** existing column values → `owner` vs `seed` in `tenant_field_meta` (Alvin #5)
2. **Import weight:** confirmed import flip to owner is Desk/Brain UX; Platform RPCs support `confirm_tenant_field`
3. **Structured payments / holds policy** shapes are P1; gate reads best-effort on today's `business_policies` JSON
