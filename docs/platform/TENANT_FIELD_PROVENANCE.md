# Tenant field provenance (GIGO BI P0)

Platform-owned sidecar for **who said a tenant fact is true**. Values stay on existing `tenants` columns; provenance lives in `tenant_field_meta` keyed by `field_path`.

SQL: [`docs/supabase/tenant_field_provenance.sql`](../supabase/tenant_field_provenance.sql)  
Field map: see GIGO BI P0 Platform field map (tenant columns / JSON leaves; no parallel domain tables).

## Apply

Run in Supabase SQL Editor **after** [`product_catalog_and_social.sql`](../supabase/product_catalog_and_social.sql). Do not apply to production ALCR until reviewed.

On apply, the script runs **`backfill_tenant_field_meta_seed()`** once (idempotent re-runs skip existing paths).

## field_path conventions

| Pattern | Example |
| --- | --- |
| Scalar column | `identity.business_name`, `identity.vertical`, `assistant.agent_name` |
| Policy key | `policies.returns`, `policies.delivery`, `policies.payment`, `policies.holds.allowed` |
| Hours (live) | `hours.weekly_grid` → `tenants.hours_schedule` |
| Catalog product leaf | `catalog.product.<sku_or_index>.name` |
| Catalog service leaf | `catalog.service.<index>.name` |
| FAQ row | `faqs.<index>` (status/source on the FAQ object in `tenants.faqs`) |
| Notify | `team.notify.whatsapp`, `team.notify.email`, `team.notify.channels` |

Prefer stable `sku` when present; otherwise index (rewrite-sensitive).

**JSON null guard:** `business_policies.coverage_areas` may be JSON `null` (not SQL NULL); use `jsonb_typeof(...) = 'array'` before `jsonb_array_length`.

## Envelope rules

- **source:** `owner` \| `seed` \| `import` \| `inferred` \| `call_suggested`
- **Completeness weight:** **owner** (or post-confirm) 100%; **import** 0% until `confirm_tenant_field` (Alvin §10.2); seed / inferred / call_suggested / **missing meta** 0%
- **ready_badge:** requires owner-provenance rows (including `team.notify.*`), domain thresholds; **never** true for seed-only or unconfirmed-import tenants
- **Compile (Brain):** must emit only **owner** or **confirmed** values into `llm_system_prompt`. Seeds and unconfirmed imports belong in UNKNOWN. Compiler change is Brain-owned; Platform only documents the contract.

## Alvin decisions

### §10.5 bulk backfill = seed

Existing non-empty tenant scalars and JSON leaves get **`tenant_field_meta` rows with `source=seed`**, `source_ref=backfill:roadmap_10_5`, `confirmed_*` and `last_verified_at` null. Inserts **only when the path is absent**; never overwrites existing owner / import / confirmed meta.

Same posture as **FAQ demotion** (`status=suggested`, `source=seed` on legacy FAQ rows).

Re-run safely: `select public.backfill_tenant_field_meta_seed();` (service role).

### §10.2 import weight = 0% until confirm

Desk/Platform tag fresh imports with `upsert_tenant_field_meta(..., source='import')`. They contribute **0** to `tenant_completeness_score` until the owner confirms; then `confirm_tenant_field` sets `source=owner` and the field counts at 100%.

## RPCs (stable names)

| RPC | Role |
| --- | --- |
| `upsert_tenant_field_meta(...)` | Tag or update provenance; appends history on source change |
| `confirm_tenant_field(tenant_id, field_path, user_id)` | Sets `source=owner`, confirmation timestamps |
| `tenant_completeness_score(tenant_id)` | `{ overall, domains, ready_badge, next_gaps }` |
| `tenant_hold_gate(tenant_id)` | `{ allowed, reasons[] }` for place_hold |
| `backfill_tenant_field_meta_seed()` | §10.5 seed backfill for populated fields |

## Hold gate (Platform read model)

Allowed only when all hold:

1. Holds enabled in `business_policies` (`holds.allowed`, nested `holds`, or owner meta on `policies.holds.allowed`)
2. At least one **holdable** `product_catalog` row with **owner** meta on `catalog.product.<sku>.name`
3. Verified notify target: WhatsApp number + channel on, or alert email + channel on, or owner meta on `team.notify.whatsapp`

Brain consumes `tenant_hold_gate`; voice/tools should not promise holds when `allowed` is false. **Hold deposit wording on calls** is Brain/product (roadmap §10 #3), not Platform.

## Thin clients

- Voice / jobs: `src/db.js` — `getTenantCompletenessScore`, `getTenantHoldGate`, `upsertTenantFieldMeta`, `confirmTenantField`
- Desk server: `dashboard/src/lib/tenantFieldProvenance.ts`

## Verify RPCs (staging)

```sql
-- Replace with a tenant id you own
select public.tenant_completeness_score('00000000-0000-0000-0000-000000000001'::uuid);
select public.tenant_hold_gate('00000000-0000-0000-0000-000000000001'::uuid);

-- After backfill only: expect low overall and ready_badge false until owner confirms
select public.backfill_tenant_field_meta_seed();

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

## Open decisions (remaining)

1. **Structured payments / holds policy** shapes are P1; gate reads best-effort on today's `business_policies` JSON.

**Decided:** bulk backfill = **seed** (§10.5); import completeness = **0%** until confirm (§10.2). Hold deposit speak = Brain/product, not this PR.
