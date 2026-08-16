# Technical debt register

**Status:** Governance baseline (updated Phase 3F, 2026-08-15)  
**Source:** Discovery audit + codebase evidence. Items are **not** fixed in Phase 2.

Status: `OPEN` unless noted.

---

## P0 — Critical

### TD-P0-1: Agent configuration not traceable per call

| Field | Detail |
| --- | --- |
| **Problem** | Cannot answer "which exact agent configuration handled this call?" |
| **Evidence** | No `agent_version` / `prompt_hash` on `calls`; `llm_system_prompt` not snapshotted; brain traces stdout-only |
| **Impact** | Support, debugging, compliance, and beta feedback attribution blocked |
| **Recommended action** | Future project: `call_agent_snapshots` table + registry — see `docs/agents/PROMPT_VERSIONING.md` |
| **Status** | OPEN |

### TD-P0-2: Production database migration state unknown

| Field | Detail |
| --- | --- |
| **Problem** | Manual SQL apply with incomplete per-script record on production |
| **Evidence** | 35 scripts in `docs/supabase/`; CLI ledger has 24 rows; bulk manual era UNKNOWN |
| **Impact** | Schema drift, silent feature degradation |
| **Mitigation (Phase 3E–3F)** | Staging full rebuild from Git **PASS**; drift policy + hardened ledger |
| **Recommended action** | Read-only production catalog audit; backfill ledger; staging-vs-prod diff before SQL releases |
| **Status** | OPEN (severity reduced — reproducibility proven on staging) |

---

## P1 — High

### TD-P1-1: `server.js` monolith

| Field | Detail |
| --- | --- |
| **Problem** | 2,841 LOC; media handler ~1,150 LOC; merge conflict risk |
| **Evidence** | `AGENTS.md` rule against parallel `server.js` edits; line count |
| **Impact** | Slow reviews, regression risk in voice latency/barge-in |
| **Recommended action** | Phase C extraction: notifications → routes → media session → turn loop |
| **Status** | OPEN |

### TD-P1-2: JS/TS duplication (intro, lexicon)

| Field | Detail |
| --- | --- |
| **Problem** | Parallel voice JS and desk TS implementations differ |
| **Evidence** | `businessAssistantIntro.js` vs `.ts`; `pronunciationLexicon.js` vs `.ts`; desk comment "keep in sync" |
| **Impact** | Desk preview may not match live voice behavior |
| **Recommended action** | Future `packages/shared` or contract tests (not Phase 2) |
| **Status** | OPEN |

### TD-P1-3: No CI in repository

| Field | Detail |
| --- | --- |
| **Problem** | No automated merge gate |
| **Evidence** | No `.github/workflows/` |
| **Impact** | Regressions can reach `main` undetected |
| **Recommended action** | Add CI: `test:voice`, `test:mvp`, dashboard build |
| **Status** | OPEN |

### TD-P1-4: Verbose request logging

| Field | Detail |
| --- | --- |
| **Problem** | Full HTTP headers and raw webhook bodies logged |
| **Evidence** | Was `server.js` inbound middleware, `/voice/incoming`, `/voice/events`, `/ws/media` upgrade + JSON frames |
| **Impact** | PII/credential exposure in log sinks |
| **Recommended action** | Redact logging in dedicated PR (behavior change — needs approval) |
| **Status** | REMEDIATED (2026-08-16) — `src/sautikit/safeLog.js` summaries; secrets/PII redacted; WS payloads sampled |

---

## P2 — Medium

### TD-P2-1: Legacy Super Admin cookie auth

| Field | Detail |
| --- | --- |
| **Problem** | `DASHBOARD_PASSWORD` HMAC cookie bypasses Supabase RBAC |
| **Evidence** | `auth.ts` `isLegacyAuthenticated()`, `admin/layout.tsx` |
| **Impact** | Weak ops access model |
| **Recommended action** | Supabase role-based admin migration |
| **Status** | OPEN |

### TD-P2-2: `TenantForm.tsx` monolith

| Field | Detail |
| --- | --- |
| **Problem** | 2,181 LOC single settings component |
| **Evidence** | Line count |
| **Impact** | Desk maintainability, review burden |
| **Recommended action** | Tab-scoped components matching settings nav |
| **Status** | OPEN |

### TD-P2-3: Stale architecture doc sections

| Field | Detail |
| --- | --- |
| **Problem** | Blueprint described Twilio as current baseline |
| **Evidence** | `ARCHITECTURE_MIGRATION_BLUEPRINT.md` (partially corrected Phase 2) |
| **Impact** | Onboarding confusion |
| **Recommended action** | Ongoing doc hygiene; prefer `docs/architecture/CURRENT_STATE.md` |
| **Status** | OPEN (mitigated) |

### TD-P2-4: Dashboard lint failure

| Field | Detail |
| --- | --- |
| **Problem** | Lint errors blocking CI |
| **Evidence** | Was `retailOnboardingPack.ts` unused var; now warning only in `PronunciationCoach.tsx` |
| **Impact** | Low — build passes |
| **Recommended action** | Clean warning in chore PR |
| **Status** | OPEN (downgraded — errors resolved) |

### TD-P2-5: No staging environment

| Field | Detail |
| --- | --- |
| **Problem** | Staging topology not documented |
| **Evidence** | Phase 3E created `scalers-staging` (`sgcdncjxauhsbunobmob`); rebuilt from Git |
| **Impact** | Was production-only validation |
| **Resolution** | `ENVIRONMENTS.md`, `ENVIRONMENT_CONTRACT.md`, `STAGING_REBUILD_EXECUTION_REPORT.md` |
| **Remaining gap** | Dedicated staging voice/desk deploy URLs not standardized in repo |
| **Status** | **MITIGATED** (DB staging active; deploy topology partial) |

### TD-P2-6: Stale remote branches

| Field | Detail |
| --- | --- |
| **Problem** | 143 `cursor/*` remote branches |
| **Evidence** | `git branch -r` count |
| **Impact** | Clutter, confusion about active work |
| **Recommended action** | Branch lifecycle policy; human-approved cleanup |
| **Status** | OPEN |

---

## P3 — Low

### TD-P3-1: Legacy `/ws/relay` path

| Field | Detail |
| --- | --- |
| **Problem** | ConversationRelay handler still wired |
| **Evidence** | `server.js:2261+`, `VOICE.md` |
| **Impact** | Dead code surface |
| **Recommended action** | Deprecate + remove after production verification |
| **Status** | OPEN |

### TD-P3-2: Package name drift

| Field | Detail |
| --- | --- |
| **Problem** | `missed-call-agent` vs `scalers-project` vs Scalers brand |
| **Evidence** | `package.json` name vs Git remote |
| **Impact** | Onboarding friction |
| **Recommended action** | Rename in dedicated chore PR |
| **Status** | OPEN |

### TD-P3-3: Hardcoded Railway URL default

| Field | Detail |
| --- | --- |
| **Problem** | `voicePublicBase.js` defaults to production Railway host |
| **Evidence** | `dashboard/src/lib/voicePublicBase.js:9` |
| **Impact** | Wrong preview if env unset |
| **Recommended action** | Require explicit `VOICE_PUBLIC_BASE_URL` |
| **Status** | OPEN |

### TD-P3-4: Duplicate `soniox-voices.json`

| Field | Detail |
| --- | --- |
| **Problem** | Identical JSON in `src/data/` and `dashboard/src/data/` |
| **Evidence** | Same MD5 hash |
| **Impact** | Sync burden on catalog updates |
| **Recommended action** | Single source file when shared package exists |
| **Status** | OPEN |

### TD-P3-5: No npm workspaces

| Field | Detail |
| --- | --- |
| **Problem** | Two independent packages, double install |
| **Evidence** | Separate `package.json` files |
| **Impact** | DX friction |
| **Recommended action** | Future monorepo tooling project |
| **Status** | OPEN |

---

## Related documents

- [`SCALERS_ENGINEERING_PRINCIPLES.md`](./SCALERS_ENGINEERING_PRINCIPLES.md)
- [`../agents/PROMPT_VERSIONING.md`](../agents/PROMPT_VERSIONING.md)
- [`../database/DATABASE_GOVERNANCE.md`](../database/DATABASE_GOVERNANCE.md)
