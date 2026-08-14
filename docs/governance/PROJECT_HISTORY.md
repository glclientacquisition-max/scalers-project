# Project history

**Status:** Reconstructed from Git evidence (2026-08-14)  
**Repository:** `scalers-project` · 286 commits · baseline `5b875dc`

Legend:
- **FACT** — supported by commit SHA or file evidence in repo
- **INFERENCE** — reasonable interpretation, not individually commit-proven
- **RECONSTRUCTED** — milestone synthesized from multiple commits/docs

Do not treat this as a semver release history. No fabricated version numbers.

---

## Timeline

### Pre-repository / early (July 2026)

| When | Milestone | Evidence | Label |
| --- | --- | --- | --- |
| 2026-07 | Initial AI receptionist project | `293a281` "Initial AI receptionist project" | **FACT** |
| — | Work before July 2026 | Only 1 July commit in repo | **UNKNOWN** (may exist elsewhere) |

---

### Architecture definition (early August 2026)

| When | Milestone | Evidence | Label |
| --- | --- | --- | --- |
| Aug 2026 | SautiKit/Soniox/Supabase blueprint approved | `4907ea7` PR #2, `docs/ARCHITECTURE_MIGRATION_BLUEPRINT.md` | **FACT** |
| Aug 2026 | Target modular layout documented | `docs/TARGET_MODULE_LAYOUT.md` | **FACT** |

**RECONSTRUCTED — Historical stack (pre-migration):** Twilio ConversationRelay + SQLite + single Express process. Documented in blueprint §1 as the starting baseline. Twilio is **no longer** the active telephony path.

---

### Phase 1: Persistence migration

| When | Milestone | Evidence | Label |
| --- | --- | --- | --- |
| Aug 2026 | SQLite → Supabase | `9153a09`, `34d0d54` | **FACT** |
| Aug 2026 | `src/db.js` + `supabaseClient.js` replace local DB | Files present; `.gitignore` still ignores `*.db` | **FACT** |

---

### Phase 2–4: SautiKit + media WebSocket

| When | Milestone | Evidence | Label |
| --- | --- | --- | --- |
| Aug 2026 | SautiKit TwiML Connect/Stream | `aca2233` | **FACT** |
| Aug 2026 | Drop Twilio boot requirements | `d19a1dd` | **FACT** |
| Aug 2026 | `/ws/media` hardening (1006 fixes, noServer router) | `3c81090`, `f4bf5a4`, `5bfd83e` | **FACT** |
| Aug 2026 | Stream `connect="true"` requirement | `2b3b009`, comments in `server.js` | **FACT** |
| Aug 2026 | Webhook on `POST /` and `/voice/incoming` | `e00ab4f` | **FACT** |

**INFERENCE:** "Phase 4 full duplex agent" branches merged during this period (remote branch names; not every merge individually verified).

---

### Multi-tenancy and security

| When | Milestone | Evidence | Label |
| --- | --- | --- | --- |
| Aug 2026 | `tenant_members`, signup provision trigger | `multi_tenant_onboarding.sql` | **FACT** |
| Aug 2026 | Owner RLS policies | `owner_rls.sql`, `dashboard/README.md` Sprint 1 | **FACT** |
| Aug 2026 | Tenant business profile columns | `tenant_business_profile.sql` | **FACT** |

---

### Dashboard (Phase 6)

| When | Milestone | Evidence | Label |
| --- | --- | --- | --- |
| Aug 2026 | Next.js desk app in `dashboard/` | Package, routes, README Phase 6 | **FACT** |
| Aug 2026 | Onboarding wizard + prompt compiler | `onboarding/`, `promptCompiler.ts` | **FACT** |
| Aug 2026 | Owner command center / calls triage | PRs #107–#129 range, desk README | **INFERENCE** |
| Aug 2026 | Business Settings density / hierarchy UX | PRs #120–#125 | **FACT** (merge commits) |

---

### Brain / retail

| When | Milestone | Evidence | Label |
| --- | --- | --- | --- |
| Aug 2026 | Brain state, tools, catalog grounding | `src/conversation/*`, tests | **FACT** |
| Aug 2026 | Retail playbooks + MVP test pack | PR #142 `test:mvp`, `MVP_SHIP_AND_TEST.md` | **FACT** |
| Aug 2026 | Targeted catalogue retrieval, escalate hardening | PRs #136, #139 | **FACT** |
| Aug 2026 | Brand-first business assistant intro | PR #145 | **FACT** |

---

### Wallet / DID / Ops

| When | Milestone | Evidence | Label |
| --- | --- | --- | --- |
| Aug 2026 | Wallet metering → one-wallet KES | `wallet_metering.sql`, `one_wallet_billing.sql` | **FACT** |
| Aug 2026 | Beta wallet security + enforcement off | `wallet_security_beta.sql`, `BETA_WALLET_PROGRAM.md` | **FACT** |
| Aug 2026 | DID number pool + Super Admin | `did_number_pool.sql`, `admin/` routes | **FACT** |
| Aug 2026 | TextSMS primary notify channel | PR #144 | **FACT** |

---

### Pronunciation studio

| When | Milestone | Evidence | Label |
| --- | --- | --- | --- |
| Aug 2026 | Pronunciation coach + lexicon | `PronunciationCoach.tsx`, `pronunciationLexicon` | **FACT** |
| Aug 2026 | Gemini Scan review queue | PR #135, `pronunciation_gemini_scan.sql` | **FACT** |
| Aug 2026 | React 19 studio fix | PR #140 | **FACT** |
| Aug 2026 | Curated Soniox voice picker | PR #115, `soniox_voice_id.sql` | **FACT** |

---

### MVP beta gate (August 13–14, 2026)

| When | Milestone | Evidence | Label |
| --- | --- | --- | --- |
| 2026-08-13 | MVP ship gate + retail test pack | PR #142, `npm run test:mvp` | **FACT** |
| 2026-08-13 | Live-call dead air / filler fixes | PR #141 | **FACT** |
| 2026-08-13 | Private-beta request integrity gates | PR #143 | **FACT** |
| 2026-08-14 | Platform design mandate enforced | PR #150 | **FACT** |

---

### Agent lane governance

| When | Milestone | Evidence | Label |
| --- | --- | --- | --- |
| Aug 2026 | `AGENTS.md` five-lane model | File + lane docs | **FACT** |
| Aug 2026 | `.cursor/rules/*.mdc` per lane | 6 rule files | **FACT** |
| 2026-08-14 | Governance documentation baseline (Phase 2) | This doc tree | **FACT** (this exercise) |

---

## Safety snapshots

| Artifact | Evidence | Label |
| --- | --- | --- |
| Git tag `backup/2026-08-13` | `git tag -l` | **FACT** |
| Remote branch `backup/history-2026-08-13` | `git branch -r` | **FACT** |
| Purpose of backup | — | **UNKNOWN** |

---

## Abandoned or superseded approaches

| Approach | Evidence | Current status |
| --- | --- | --- |
| Twilio ConversationRelay telephony | Blueprint, `/ws/relay` in `server.js` | **DEPRECATED** (relay LEGACY) |
| SQLite local persistence | Early commits; `.gitignore` | **REMOVED** |
| Dual USD/KES wallets | Schema deprecation notes | **MIGRATED** to one KES wallet |
| `escalation_enabled` Telegram toggle | SQL README | **ABANDONED** |
| `TELEPHONY_PROVIDER` flags | `TARGET_MODULE_LAYOUT.md` only | **NEVER IMPLEMENTED** |
| Provider-flag modular split | Blueprint target tree | **PLANNED, not done** |

---

## Development velocity (context)

| Metric | Value | Label |
| --- | --- | --- |
| Commits in Aug 2026 | ~285 | **FACT** |
| Merged PRs (recent) | #150 latest | **FACT** |
| Primary contributor | Cursor Agent (262 commits all branches) | **FACT** |
| Revert commits | None found | **FACT** |

---

## Related documents

- [`HISTORY_GAPS.md`](./HISTORY_GAPS.md)
- [`../adr/README.md`](../adr/README.md)
- [`../architecture/CURRENT_STATE.md`](../architecture/CURRENT_STATE.md)
