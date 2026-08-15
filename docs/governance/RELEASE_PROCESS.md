# Release process

**Status:** Governance baseline (2026-08-14)  
**Note:** No historical semver releases are documented in Git. This process applies **going forward**.

---

## Versioning

Semantic versioning: `MAJOR.MINOR.PATCH`

| Bump | When |
| --- | --- |
| MAJOR | Breaking change to external contracts (DB API, webhook shapes, auth) |
| MINOR | Backward-compatible feature |
| PATCH | Bug fix, docs-only governance |

**Current package versions (informational, not release tags):**

| Package | `package.json` version |
| --- | --- |
| Voice (`missed-call-agent`) | 1.0.0 |
| Desk (`dashboard`) | 0.1.0 |

These are not proof of formal releases. First governed release should be tagged explicitly.

---

## Release preparation

1. Confirm `main` is green on test baseline (see [`TESTING_BASELINE.md`](./TESTING_BASELINE.md)).
2. Review open PRs for lane conflicts (especially `server.js`).
3. Verify Supabase SQL tier if release includes schema changes (Platform).
4. Update `CHANGELOG.md` under `[Unreleased]` → new version section.
5. Create Git tag: `vX.Y.Z` with annotated message.

---

## Testing before release

| Check | Command | Required |
| --- | --- | --- |
| Voice tests | `npm run test:voice` | Yes |
| Brain / MVP | `npm run test:mvp` | Yes |
| Desk build | `cd dashboard && npm run build` | Yes |
| Desk lint | `cd dashboard && npm run lint` | Yes (fix pre-existing error before relying on lint CI) |
| Smoke (when env available) | `npm run smoke:db`, live call test | Recommended for voice releases |

---

## Staging

**STATUS: ACTIVE** (database)

Staging Supabase project `sgcdncjxauhsbunobmob` was rebuilt from Git in Phase 3E. Use it for all pre-production SQL validation.

| Check | Command |
| --- | --- |
| DB smoke | `npm run smoke:db` (staging credentials) |
| Full gate | [`RELEASE_GATE.md`](../operations/RELEASE_GATE.md) |

Dedicated staging voice/desk URLs: see [`ENVIRONMENTS.md`](../operations/ENVIRONMENTS.md). Promotion runbook: [`STAGING_TO_PRODUCTION.md`](../operations/STAGING_TO_PRODUCTION.md).

---

## Production promotion

### Voice (Railway / Render)

1. Merge to `main`.
2. Railway builds from `Dockerfile` (see [`../operations/DEPLOYMENT.md`](../operations/DEPLOYMENT.md)).
3. Confirm `GET /healthz` → `{"ok":true}`.
4. Verify SautiKit webhooks point at production host.
5. Place test call on known DID.

### Desk (Vercel)

1. Merge to `main`.
2. Vercel builds `dashboard/` root directory.
3. Confirm env vars match voice (`VOICE_INTERNAL_SECRET`, `VOICE_PUBLIC_BASE_URL`).
4. Smoke: login, settings save, calls list.

### Database (Supabase)

1. Apply new SQL scripts in documented order on production project.
2. Record applied script names in runbook (future: migration version table).
3. Never apply `escalation_enabled.sql` (legacy stub).

---

## Rollback

| Surface | Rollback method |
| --- | --- |
| Voice | Redeploy previous Railway deployment / Docker image |
| Desk | Vercel instant rollback to prior deployment |
| Database | Forward-fix only — no destructive rollback without Platform approval |
| Git | `git revert <merge-commit>` on `main` — do not force-push |

---

## Git tags and changelog

- Tag releases on `main`: `git tag -a vX.Y.Z -m "..."`
- Record changes in [`../../CHANGELOG.md`](../../CHANGELOG.md)
- Do not invent historical release notes

---

## Beta program

During private beta:

- `billing_enforcement = off` default (meter only) — see `docs/BETA_WALLET_PROGRAM.md`
- MVP gate: `npm run test:mvp` + `docs/MVP_SHIP_AND_TEST.md`

---

## Related documents

- [`DEVELOPMENT_WORKFLOW.md`](./DEVELOPMENT_WORKFLOW.md)
- [`TESTING_BASELINE.md`](./TESTING_BASELINE.md)
- [`../operations/DEPLOYMENT.md`](../operations/DEPLOYMENT.md)
