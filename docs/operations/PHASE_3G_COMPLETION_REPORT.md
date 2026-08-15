# Phase 3G completion report

**Date:** 2026-08-15  
**Branch:** `cursor/phase-3g-automation-beta-d058`  
**Base:** Phase 3F governance + `main` lineage  
**Production ALCR:** NOT modified

---

## Objective

Convert Phase 3F governance into practical automation, close highest-value gaps (documentation + prepared fixes), and assess beta readiness — without production mutation.

---

## Deliverables

### CI automation

| Item | Status |
| --- | --- |
| PR gate: `test:voice`, `test:mvp`, desk lint, desk build | **DONE** — `.github/workflows/ci.yml` |
| Removed redundant `test:brain` job step | **DONE** (included in `test:mvp`) |
| `npm run release:candidate` | **DONE** — `scripts/release-candidate.sh` |

### Staging automation

| Item | Status |
| --- | --- |
| Post-merge workflow | **DONE** — `.github/workflows/staging-validate.yml` |
| `smoke:db` on staging | **DONE** (requires GitHub secrets) |
| Documentation | **DONE** — `STAGING_VALIDATION.md` |

### Schema drift automation

| Item | Status |
| --- | --- |
| Manifest | **DONE** — `docs/database/staging_schema_manifest.json` |
| Verify script | **DONE** — `scripts/verify-staging-schema.js` |
| Lightweight + catalog modes | **DONE** |
| Production block | **DONE** (refuses `fjxcdccgyhnvnnlnovcl`) |
| Documentation | **DONE** — `SCHEMA_DRIFT_AUTOMATION.md` |

### notify_channels production fix

| Item | Status |
| --- | --- |
| Investigation doc | **DONE** — `PRODUCTION_CHANGE_NOTIFY_CHANNELS.md` |
| SQL artifact | **DONE** — `production_pending/grant_notify_channels_update.sql` |
| Applied to production | **NO** (Rule 0) |

### Storage security

| Item | Status |
| --- | --- |
| Model doc | **DONE** — `docs/storage/STORAGE_SECURITY_MODEL.md` |
| PROPOSED policy SQL | **DONE** — `production_pending/storage_call_recordings_policies.sql` |
| Applied to production | **NO** |

### Production ledger

| Item | Status |
| --- | --- |
| CLI backfill (24 rows) | **DONE** — `MIGRATION_LEDGER.md` with inferred dates |
| Pre-CLI bulk dates | **UNKNOWN** (unchanged) |
| Production catalog query | **NOT RUN** (Rule 0) |

### Environment standardization

| Item | Status |
| --- | --- |
| Staging Supabase ref documented | **YES** |
| Production URLs (inference) | **YES** |
| Dedicated staging Railway/Vercel URLs | **UNKNOWN** (marked explicitly) |

### Beta readiness

| Item | Status |
| --- | --- |
| Audit doc | **DONE** — `BETA_READINESS_AUDIT.md` |

---

## Tests executed

| Command | Result |
| --- | --- |
| `npm run test:voice` | PASS |
| `npm run test:mvp` | PASS |
| `cd dashboard && npm run lint` | PASS |
| `cd dashboard && npm run build` | PASS |
| `npm run release:candidate` | PASS |
| `npm run verify:staging-schema` | PASS (staging) |
| `npm run smoke:db` | PASS (staging) |

---

## Files created

- `.github/workflows/staging-validate.yml`
- `scripts/verify-staging-schema.js`
- `scripts/release-candidate.sh`
- `docs/database/staging_schema_manifest.json`
- `docs/database/SCHEMA_DRIFT_AUTOMATION.md`
- `docs/operations/STAGING_VALIDATION.md`
- `docs/operations/PRODUCTION_CHANGE_NOTIFY_CHANNELS.md`
- `docs/operations/BETA_READINESS_AUDIT.md`
- `docs/operations/PHASE_3G_COMPLETION_REPORT.md`
- `docs/storage/STORAGE_SECURITY_MODEL.md`
- `docs/supabase/production_pending/*`

## Files modified

- `.github/workflows/ci.yml`
- `package.json` (+ `pg` devDependency, npm scripts)
- `docs/supabase/MIGRATION_LEDGER.md`
- `docs/operations/ENVIRONMENT_CONTRACT.md`
- `docs/operations/RELEASE_GATE.md`

---

## Remaining risks

| Risk | Severity |
| --- | --- |
| notify_channels grant not on production | P1 |
| Storage policies UNKNOWN / not in Git | P1 |
| Staging GitHub secrets not yet configured | P2 |
| Staging Railway/Vercel URLs UNKNOWN | P2 |
| Pre-CLI production apply dates UNKNOWN | P2 |
| No live-call automated CI | P1 |

---

## Readiness matrix

### A. READY NOW

- PR CI: voice, MVP, desk lint/build
- `npm run release:candidate` for code promotion checks
- Staging DB rebuild path (Phase 3E)
- Staging schema verify script (lightweight)
- Feature development contracts and release gate docs
- notify_channels + storage production fixes **prepared**

### B. REQUIRED BEFORE BETA

- Configure `STAGING_SUPABASE_*` GitHub secrets
- Apply `grant_notify_channels_update.sql` to **production** (human-approved)
- Live call smoke on staging or production test DID
- Desk E2E on staging (notify settings save)
- Decide on storage policy SQL (staging first, then production)

### C. REQUIRED BEFORE PRODUCTION SCALE

- Full production catalog audit (read-only) to close ledger gaps
- CI staging validation green on every `main` push
- Dedicated staging voice/desk deploy URLs documented
- Redact verbose logging (TD-P1-4)
- Agent config traceability (TD-P0-1)

### D. FUTURE / OPTIONAL

- `STAGING_DATABASE_URL` catalog mode in CI
- Staging-vs-production schema diff automation
- Supabase CLI migration cutover
- E2E browser tests

---

## Success condition checklist

| # | Criterion | Met |
| --- | --- | --- |
| 1 | PR quality checks automated | **YES** |
| 2 | Staging validation repeatable path | **YES** (secrets required) |
| 3 | Schema drift detectable safely | **YES** (staging only) |
| 4 | notify_channels fix prepared, not executed | **YES** |
| 5 | Storage security understood | **YES** |
| 6 | Production ledger improved | **YES** (CLI backfill) |
| 7 | Environment boundaries explicit | **YES** |
| 8 | MVP beta readiness assessed | **YES** |
| 9 | No production mutation | **YES** |

**Team can return to product development** with CI gates, staging validation path, and documented production-pending fixes.

---

## Related documents

- [`BETA_READINESS_AUDIT.md`](./BETA_READINESS_AUDIT.md)
- [`STAGING_VALIDATION.md`](./STAGING_VALIDATION.md)
- [`../database/SCHEMA_DRIFT_AUTOMATION.md`](../database/SCHEMA_DRIFT_AUTOMATION.md)
