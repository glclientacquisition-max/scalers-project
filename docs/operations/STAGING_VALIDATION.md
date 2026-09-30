# Staging validation workflow

**Status:** Phase 3G (2026-08-15)  
**Automation:** `.github/workflows/staging-validate.yml`

---

## Lifecycle

```
PR opened, updated, reopened, or closed against main
  ↓ stage-pull-request.yml rebuilds cursor/staging-voice-468b
     as main plus pull requests still open
  ↓ Railway staging Voice + Vercel scalers-staging deploy that branch
  ↓ confirm staging /healthz.gitSha and scalers-staging.vercel.app
  ↓ DID + desk test
  ↓ squash-merge that feature PR into main, or close it to take it off staging
  ↓ production Desk (scalers-project) and production Voice follow main
  ↓ staging-validate.yml (DB smoke)
  ↓ release candidate approval
  ↓ production (human-approved SQL + deploy)
```

Official staging Desk is `https://scalers-staging.vercel.app`. Official staging Voice is Railway. Both run **`cursor/staging-voice-468b`**. `stage-pull-request.yml` rebuilds that branch as `main` plus open pull requests, then connects Railway **scalers staging** to that branch with no commit SHA. A pinned SHA ignores the branch, so `/healthz` stays on the old commit until the pin is cleared. Closing a pull request rebuilds staging without it. Vercel `scalers-staging` skips production builds that are not that branch, so a `main` merge does not overwrite the staging Desk URL. Feature PRs still get a preview URL for a UI glance. Promote by squash-merging the tested feature pull request into `main`. Leave **scalers-project** production branch on `main`. Optional: set **scalers-staging → Settings → Git → Production Branch** to `cursor/staging-voice-468b` so the official URL auto-assigns on every staging-branch push.

---

## What runs automatically

| Trigger | Workflow | Requires secrets |
| --- | --- | --- |
| Every PR | `ci.yml` | No |
| PR opened, updated, reopened, or closed against `main`, and every push to `main` | `stage-pull-request.yml` | `GITHUB_TOKEN` force-pushes the staging branch. Railway staging token + IDs reconnect **scalers staging** to that branch with no commit SHA, then a deploy starts. |
| Push to `main` | `staging-validate.yml` | Staging Supabase (warns if missing) |
| Manual | `workflow_dispatch` on staging-validate | Staging Supabase |
| Manual | `staging-voice-deploy.yml` on a PR branch | Railway staging token + IDs |

---

## GitHub secrets (repository settings)

| Secret | Purpose |
| --- | --- |
| `STAGING_SUPABASE_URL` | `https://sgcdncjxauhsbunobmob.supabase.co` |
| `STAGING_SUPABASE_SERVICE_ROLE_KEY` | Staging service role — **never production** |
| `STAGING_DATABASE_URL` | Optional — postgres URL for full catalog verify. Prefer **Supabase pooler** URI (port **6543**) in GitHub Actions; direct `db.*.supabase.co` can fail with IPv6 `ENETUNREACH` on runners. |
| `RAILWAY_TOKEN` | Railway token for `stage-pull-request.yml` and `staging-voice-deploy.yml` |
| `RAILWAY_STAGING_PROJECT_ID` | Staging Voice project id |
| `RAILWAY_STAGING_SERVICE_ID` | Staging Voice service id |
| `RAILWAY_STAGING_ENVIRONMENT_ID` | Staging environment id. Workflow refuses any name other than `staging`. |

**Safety:** Workflow refuses URLs containing production ref `fjxcdccgyhnvnnlnovcl`. Voice deploy also refuses a Railway environment whose name is not `staging` and refuses a `SUPABASE_URL` that points at ALCR.

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
- [`STAGING_TO_PRODUCTION.md`](./STAGING_TO_PRODUCTION.md)
- [`../database/SCHEMA_DRIFT_AUTOMATION.md`](../database/SCHEMA_DRIFT_AUTOMATION.md)
