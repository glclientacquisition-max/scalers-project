# Staging → production promotion

**Status:** Canonical (2026-08-15)  
**Purpose:** Repeatable path from validated staging work to live production (ALCR).

Staging and production **do not sync automatically**. Promote **code**, **SQL**, and **config** deliberately.

---

## Environment map

| Layer | Staging | Production |
| --- | --- | --- |
| **Desk** | `https://scalers-staging.vercel.app` | `https://scalers-project.vercel.app` |
| **Voice** | `https://scalers-staging-staging.up.railway.app` | `https://scalers-project-production.up.railway.app` |
| **Database** | `sgcdncjxauhsbunobmob` (`scalers-staging`) | `fjxcdccgyhnvnnlnovcl` (ALCR) |
| **Vercel project** | `scalers-staging` | `scalers-project` |
| **Railway** | Environment `staging` (voice service) | Production voice service |

**Safety rule:** If `SUPABASE_URL` contains `fjxcdccgyhnvnnlnovcl`, you are on production. Stop unless the change is human-approved.

---

## What carries over (and what does not)

| Item | Staging → production? |
| --- | --- |
| Git `main` after merge | **Yes** — deploy production apps from same commit |
| CI + `staging-validate` green | **Yes** — required gate |
| Staging test users / tenant rows | **No** — separate databases |
| Settings saved on staging Desk | **No** |
| SQL applied on staging Supabase | **No** — re-apply on ALCR after approval |
| Env vars on staging Vercel/Railway | **No** — production projects have their own vars |

---

## Promotion flow (overview)

```
Change on branch
      ↓
PR → CI green
      ↓
Test on STAGING (Desk + Voice + Supabase sgcdncjxauhsbunobmob)
      ↓
Merge to main
      ↓
staging-validate.yml green (DB smoke on main)
      ↓
Promote (code / SQL / config — see below)
      ↓
Production smoke on ALCR + production URLs
```

Full gate checklist: [`RELEASE_GATE.md`](./RELEASE_GATE.md).

---

## Path A — Code only (no new SQL)

Use when the change is application code only (UI, voice logic, prompts in repo). No new `docs/supabase/*.sql`.

### Before merge

- [ ] `npm run test:voice` — pass
- [ ] `npm run test:mvp` — pass
- [ ] `cd dashboard && npm run lint && npm run build` — pass
- [ ] Feature tested on **staging Desk** (`scalers-staging.vercel.app`)
- [ ] If voice-impacting: test call on **staging Voice** + staging test DID

### Merge

1. Open PR → wait for **CI** green.
2. Merge to `main`.
3. Confirm **staging-validate** workflow green on `main` (smoke + schema).

### Deploy production (manual)

| Surface | Where | Action |
| --- | --- | --- |
| **Voice** | Railway → production voice service | Deploy / redeploy from `main` |
| **Desk** | Vercel → `scalers-project` | Production deploy from `main` (auto or promote) |

**Do not** deploy production by changing staging projects. Staging Vercel/Railway are separate.

### Production env check (names only)

Production must still point at ALCR:

- `SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_URL` → `https://fjxcdccgyhnvnnlnovcl.supabase.co`
- `VOICE_PUBLIC_BASE_URL` (desk) → production Railway URL
- `VOICE_INTERNAL_SECRET` — **same** on production desk and production voice

### Production smoke (required)

- [ ] `GET https://scalers-project-production.up.railway.app/healthz` → `ok`
- [ ] Desk login + settings save on `scalers-project.vercel.app`
- [ ] If voice changed: one test call on a **production** DID

### Rollback

| Surface | Action |
| --- | --- |
| Voice | Railway → redeploy previous deployment |
| Desk | Vercel → instant rollback |
| Git | `git revert` merge commit on `main` |

---

## Path B — Database change (SQL)

Use when adding columns, grants, functions, RLS, or policies.

### Staging first (required)

1. Add or update script under `docs/supabase/` (follow [`DATABASE_APPLY_ORDER.md`](../database/DATABASE_APPLY_ORDER.md)).
2. Apply in **Supabase SQL Editor** on **scalers-staging** only.
3. Run `npm run smoke:db` against staging credentials.
4. Test affected Desk/Voice flows on staging.
5. Update [`MIGRATION_LEDGER.md`](../supabase/MIGRATION_LEDGER.md) (staging applied date).

**Example (Phase 3H):** column grants from `product_catalog_and_social.sql` and `soniox_voice_id.sql` were applied on staging after signup/settings failures.

### Merge code (if any)

If the feature needs app code that depends on the schema, merge the PR after staging SQL is proven.

### Production SQL (human approval required)

1. Review script in PR or `docs/supabase/production_pending/`.
2. **Explicit human approval** — no agent-applied production SQL.
3. Apply **same script** on **ALCR** (`fjxcdccgyhnvnnlnovcl`) in Supabase SQL Editor.
4. Record in `MIGRATION_LEDGER.md` with production apply date.
5. Deploy production apps if code was waiting on schema.
6. Production smoke for the specific feature.

**Pending production example:** `docs/supabase/production_pending/grant_notify_channels_update.sql` — see [`PRODUCTION_CHANGE_NOTIFY_CHANNELS.md`](./PRODUCTION_CHANGE_NOTIFY_CHANNELS.md).

### Rollback

Database: **forward-fix only**. Do not drop production columns without Platform approval. Prefer `REVOKE` / compensating migration documented in the same folder.

---

## Path C — Config / integrations only

Use when changing env vars, webhooks, or provider routing without code or SQL.

| Config | Staging | Production |
| --- | --- | --- |
| Supabase keys | `scalers-staging` Vercel + Railway staging | `scalers-project` Vercel + Railway prod |
| `VOICE_PUBLIC_BASE_URL` | `https://scalers-staging-staging.up.railway.app` | `https://scalers-project-production.up.railway.app` |
| `VOICE_INTERNAL_SECRET` | Staging-only value (match desk ↔ voice) | Production value (match desk ↔ voice) |
| SautiKit voice webhook | Test DID → staging Railway `/voice/incoming` | Live DIDs → production Railway |

**Never** copy staging `SUPABASE_SERVICE_ROLE_KEY` into production projects or vice versa.

After env changes: **redeploy** the affected Vercel/Railway service.

---

## Quick decision table

| You changed… | Staging action | Production action |
| --- | --- | --- |
| React / Next.js desk UI | Test on `scalers-staging.vercel.app` | Deploy `scalers-project` Vercel |
| `server.js` / voice lane | Test on staging Railway + test DID | Deploy production Railway |
| New SQL script | Apply on `sgcdncjxauhsbunobmob` | Approved apply on ALCR |
| Grant / RLS only | SQL on staging | Approved SQL on ALCR |
| GitHub Actions / docs only | CI on PR | Merge; no app deploy unless needed |
| Staging test data | Create users on staging | **Nothing** — does not migrate |

---

## Pre-flight checklist (every promotion)

Copy before any production step:

```
[ ] I know which path: A (code) / B (SQL) / C (config)
[ ] Staging Supabase ref is sgcdncjxauhsbunobmob (not ALCR)
[ ] Production Supabase ref is fjxcdccgyhnvnnlnovcl
[ ] Staging feature tested on scalers-staging.vercel.app
[ ] If voice: staging /healthz ok + test DID (not production DID)
[ ] main merge + staging-validate green (if code merge)
[ ] Production deploy targets scalers-project Vercel + production Railway
[ ] Production smoke completed after deploy
[ ] MIGRATION_LEDGER updated (if SQL)
```

---

## Related documents

- [`ENVIRONMENTS.md`](./ENVIRONMENTS.md) — URLs and variable names
- [`ENVIRONMENT_CONTRACT.md`](./ENVIRONMENT_CONTRACT.md) — safety rules
- [`RELEASE_GATE.md`](./RELEASE_GATE.md) — full gate checklist
- [`RELEASE_PROCESS.md`](../governance/RELEASE_PROCESS.md) — versioning and tags
- [`STAGING_VALIDATION.md`](./STAGING_VALIDATION.md) — CI staging DB workflow
- [`DEPLOYMENT.md`](./DEPLOYMENT.md) — build and deploy units
