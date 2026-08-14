# Testing baseline

**Recorded:** 2026-08-14  
**Branch:** `main` @ `5b875dc` (pre-governance commit)  
**Environment:** Cloud agent VM after `npm ci` (root) and `npm ci` (dashboard)

This document is the **before** snapshot for governance work. Future changes must not regress these results without documented intentional behavior change.

---

## Summary

| Check | Result | Notes |
| --- | --- | --- |
| `npm run test:voice` | **PASS** | Full voice gate |
| `npm run test:brain` | **PASS** | 69 tests, 10 suites |
| `npm run test:mvp` | **PASS** | Brain + knowledge + smokes + notify |
| `cd dashboard && npm run build` | **PASS** | Next.js 16 production build |
| `cd dashboard && npm run lint` | **FAIL** | Pre-existing — not introduced by governance |
| Test coverage | **Not measured** | No nyc/c8 in repo |
| E2E / browser tests | **None** | |
| CI integration tests | **None** | No `.github/workflows/` |
| `npm run smoke:db` | **Not run** | Requires live Supabase env |
| Other smoke scripts | **Not run** | Require API keys |

---

## Lint failure detail (pre-existing)

```
dashboard/src/lib/retailOnboardingPack.ts:105:45
  error  '_businessName' is defined but never used  @typescript-eslint/no-unused-vars
```

**Classification:** Pre-existing. Fix in dedicated `fix/*` PR — not part of Phase 2 documentation.

---

## Test frameworks

| Package | Framework | Location |
| --- | --- | --- |
| Root | Node.js built-in `node --test` + custom assert scripts | `tests/`, `package.json` scripts |
| Dashboard | ESLint 9 (`eslint .`) | `dashboard/eslint.config.mjs` |
| Dashboard unit tests | **Not configured** | No jest/vitest in `dashboard/package.json` |

---

## Root test scripts

| Script | Scope |
| --- | --- |
| `test:voice` | TTS, turn-taking, wiring, STT context, stream buffer, timing, interim barge, soniox voice |
| `test:brain` | Brain state, conversation, safety, tools, escalate, intro, call resolution |
| `test:knowledge` | Live knowledge, ingest, retail, product catalog |
| `test:mvp` | brain + knowledge + `smoke:retail` + `smoke:escalation` + `smoke:mvp` + `test:notify` |
| `test:notify` | TextSMS dispatch tests |
| `smoke:db` | Supabase connectivity (env required) |
| `smoke:retail`, `smoke:escalation`, `smoke:mvp` | Scenario smokes (env required) |

---

## Fresh clone requirements

```bash
# Root
npm ci
npm run test:voice
npm run test:mvp

# Dashboard
cd dashboard && npm ci && npm run build
```

Two separate `npm ci` — not a unified workspace install.

---

## Lane test gates (required before PR merge)

| Lane | Minimum gate |
| --- | --- |
| Voice | `npm run test:voice` |
| Brain | `npm run test:brain` or `npm run test:mvp` |
| Desk UI/UX | `cd dashboard && npm run build` (+ lint when failure fixed) |
| Platform | Desk build + SQL review; `npm run smoke:db` when env available |
| Ops | Admin flows + wallet SQL review |

---

## Governance phase impact

**FACT:** Phase 2 changes documentation only. These test commands were not re-run after doc commits unless a future validation step requires it.

Re-validate baseline before any Phase 3 structural work.

---

## Related documents

- [`RELEASE_PROCESS.md`](./RELEASE_PROCESS.md)
- [`DEVELOPMENT_WORKFLOW.md`](./DEVELOPMENT_WORKFLOW.md)
- [`TECHNICAL_DEBT.md`](./TECHNICAL_DEBT.md)
