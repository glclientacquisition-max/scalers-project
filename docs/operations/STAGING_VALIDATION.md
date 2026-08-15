# Staging validation workflow

**Status:** Phase 3G (2026-08-15)  
**Automation:** `.github/workflows/staging-validate.yml`

---

## Lifecycle

```
PR → CI (unit tests, lint, build)
  ↓ merge to main
  ↓ deploy staging (Railway/Vercel — existing infra)
  ↓ staging validation workflow
  ↓ smoke:db + schema verify
  ↓ feature smoke / manual acceptance
  ↓ release candidate approval
  ↓ production (human-approved SQL + deploy)
```

---

## What runs automatically

| Trigger | Workflow | Requires secrets |
| --- | --- | --- |
| Every PR | `ci.yml` | No |
| Push to `main` | `staging-validate.yml` | Staging Supabase (warns if missing) |
| Manual | `workflow_dispatch` on staging workflow | Staging Supabase |

---

## GitHub secrets (repository settings)

| Secret | Purpose |
| --- | --- |
| `STAGING_SUPABASE_URL` | `https://sgcdncjxauhsbunobmob.supabase.co` |
| `STAGING_SUPABASE_SERVICE_ROLE_KEY` | Staging service role — **never production** |
| `STAGING_DATABASE_URL` | Optional — postgres URL for full catalog verify. Prefer **Supabase pooler** URI (port **6543**) in GitHub Actions; direct `db.*.supabase.co` can fail with IPv6 `ENETUNREACH` on runners. |

**Safety:** Workflow refuses URLs containing production ref `fjxcdccgyhnvnnlnovcl`.

---

## Local commands

```bash
# Code-only release candidate (CI-safe)
npm run release:candidate

# With staging DB (set .env to staging project)
RUN_SMOKE_DB=1 npm run release:candidate

# Schema verify (lightweight)
npm run verify:staging-schema

# Full catalog verify (requires STAGING_DATABASE_URL + pg)
STAGING_DATABASE_URL='postgresql://...' npm run verify:staging-schema:catalog
```

---

## What is NOT automated

| Item | Reason |
| --- | --- |
| Staging Railway deploy | Uses existing Railway project; no new infra |
| Staging Vercel deploy | Uses existing Vercel project / previews |
| Production SQL apply | Human approval required (Rule 0) |
| Live call smoke | Requires SautiKit + telecom keys |

---

## Related documents

- [`RELEASE_GATE.md`](./RELEASE_GATE.md)
- [`ENVIRONMENT_CONTRACT.md`](./ENVIRONMENT_CONTRACT.md)
- [`../database/SCHEMA_DRIFT_AUTOMATION.md`](../database/SCHEMA_DRIFT_AUTOMATION.md)
