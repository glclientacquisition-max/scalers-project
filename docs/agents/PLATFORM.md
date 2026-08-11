# Platform lane contract

**Mission:** Keep shared contracts stable — Supabase schema/RLS, `src/db.js` API, auth, deploy, and cross-lane glue — so Voice / Brain / Desk / Ops can ship in parallel.

Use for database migrations, auth membership, environment/deploy, and any change that multiple lanes must consume.

## Owns (edit freely)

| Path | Role |
| --- | --- |
| `docs/supabase/**` | Canonical SQL migrations / schema notes |
| `src/db.js`, `src/lib/supabaseClient.js` | Voice-facing DB surface |
| `db.js` (root shim if present) | Compatibility export |
| `dashboard/src/lib/auth.ts` | Auth session helpers / role gates |
| `dashboard/src/lib/supabase/**`, `supabase.ts`, `tenant.ts` | Supabase clients + tenant resolution |
| `dashboard/src/app/api/login/**`, `api/logout/**`, `api/tenant/**` | Auth/session APIs |
| `docs/ARCHITECTURE_MIGRATION_BLUEPRINT.md`, `TARGET_MODULE_LAYOUT.md`, `PRODUCTION_CUTOVER.md` | Platform architecture docs |
| `Dockerfile`, `railway.toml`, `render.yaml`, root `.env.example` structure | Deploy / env skeleton |
| `AGENTS.md`, `docs/agents/**` | Lane contracts (meta) |
| `scripts/smoke-db.js` | DB smoke |

Also owns: merge conflicts on shared files; defining new stable function signatures before feature lanes land.

## Do not touch (unless unblocking a contract)

- Deep speech DSP / barge-in tuning (Voice)
- Prompt wording experiments (Brain)
- Visual marketing redesigns (Desk UI/UX)
- Wallet product pricing decisions (Ops) — Platform implements RPCs Ops specifies

## Platform invariants

1. **Stable DB surface** for voice orchestration:
   `upsertCall`, `saveCallerInfo`, `appendTranscript`, `attachRecording`, `getCall`, `markWhatsappSent`, `updateCallStatus`, `chargeCallToWallet`, `getTenantProfile`, …
2. Voice engine + Super Admin + signup provisioner use **service role**; owners use Auth JWT + **RLS**.
3. Never put service role in `NEXT_PUBLIC_*` or client bundles.
4. SQL files are additive/ordered; document apply order in the migration header + [`docs/supabase/README.md`](../supabase/README.md).
5. Tenant isolation via `tenant_members`; no cross-tenant leaks in owner policies.
6. Prefer expanding `src/db.js` behind old names over breaking `server.js` call sites.
7. Deploy split stays: voice on Railway/Render; desk on Vercel (`dashboard` root).

## Test / verify

```bash
npm run smoke:db   # when Supabase env available
cd dashboard && npm run build
```

For SQL: dry-review policies for owner vs service_role; confirm voice still resolves tenant by DID.

## Chat starter

```
You are the Scalers Platform lane agent.
Follow docs/agents/PLATFORM.md and .cursor/rules/platform.mdc.
Own Supabase schema/RLS, src/db.js contracts, auth, and deploy/env glue.
Keep the voice DB surface stable and service-role keys server-only.
Coordinate other lanes; prefer additive migrations.
Task: <one concrete platform / schema / auth / deploy change>
```

## Good first tickets

- ~~Documented apply-order index for all `docs/supabase/*.sql`~~ → [`docs/supabase/README.md`](../supabase/README.md)
- Harden owner RLS gaps on new tables
- Extract remaining storage helpers with zero behavior change
- Environment matrix sync (root `.env.example` ↔ dashboard `.env.example`)
- Module split scaffolding toward `TARGET_MODULE_LAYOUT.md` without behavior change
