# Scalers agent lanes

Specialized Cursor agents / chats. One task → one lane → one PR.

| Lane | Scope | Contract |
| --- | --- | --- |
| **Voice** | Telephony media, STT/TTS, turn-taking, call latency | [`docs/agents/VOICE.md`](docs/agents/VOICE.md) · speed plan: [`VOICE_SPEED_CONSISTENCY.md`](docs/agents/VOICE_SPEED_CONSISTENCY.md) · live findings: [`LIVE_CALL_FINDINGS.md`](docs/agents/LIVE_CALL_FINDINGS.md) · pronunciation: [`PRONUNCIATION.md`](docs/agents/PRONUNCIATION.md) · ChapterOne setup: [`CHAPTERONE_SETUP_REVIEW.md`](docs/agents/CHAPTERONE_SETUP_REVIEW.md) |
| **Brain** | Prompts, conversation logic, tools, knowledge compile | [`docs/agents/BRAIN.md`](docs/agents/BRAIN.md) |
| **Desk UI/UX** | Owner desk + marketing UI | [`docs/agents/DESK_UX.md`](docs/agents/DESK_UX.md) |
| **Ops & Billing** | Wallet, DID pool, Super Admin | [`docs/agents/OPS_BILLING.md`](docs/agents/OPS_BILLING.md) |
| **Platform** | DB surface, auth/RLS, deploy, shared contracts | [`docs/agents/PLATFORM.md`](docs/agents/PLATFORM.md) |

**Copy-paste chat starters:** [`docs/agents/PROMPTS.md`](docs/agents/PROMPTS.md)

## Rules of engagement

1. Stay inside your lane’s **owns** paths. Ask Platform before changing `src/db.js` API or Supabase SQL.
2. Do not run parallel agents that both edit `server.js` heavily.
3. Paste the lane prompt from `docs/agents/PROMPTS.md` (or `@docs/agents/…`) at the start of each new chat.
4. Prefer fresh chats per ticket; do not keep one eternal mega-thread.
5. Schema / RPC / auth contract changes: **Platform first**, then feature lanes.

---

## Documentation map (governance baseline)

| Doc | Purpose |
| --- | --- |
| [`docs/architecture/CURRENT_STATE.md`](docs/architecture/CURRENT_STATE.md) | What Scalers **is** today |
| [`docs/governance/SOURCE_OF_TRUTH.md`](docs/governance/SOURCE_OF_TRUTH.md) | Subsystem ownership |
| [`docs/governance/DEVELOPMENT_WORKFLOW.md`](docs/governance/DEVELOPMENT_WORKFLOW.md) | Branching, lifecycle, PR checklist |
| [`docs/governance/SCALERS_ENGINEERING_PRINCIPLES.md`](docs/governance/SCALERS_ENGINEERING_PRINCIPLES.md) | Permanent engineering rules |
| [`docs/agents/AGENT_ARCHITECTURE.md`](docs/agents/AGENT_ARCHITECTURE.md) | AI agent stack on live calls |
| [`docs/database/DATABASE_GOVERNANCE.md`](docs/database/DATABASE_GOVERNANCE.md) | Manual SQL model |

---

## AI agent safety protocol (all lanes)

Before changing code:

1. Read this file and the **lane contract** for your task (`docs/agents/{LANE}.md`).
2. Read [`docs/architecture/CURRENT_STATE.md`](docs/architecture/CURRENT_STATE.md) and [`docs/governance/SOURCE_OF_TRUTH.md`](docs/governance/SOURCE_OF_TRUTH.md).
3. Identify the subsystem affected and its **source of truth**.
4. Inspect existing tests for that subsystem.
5. Check `git status` and confirm your branch.
6. Identify dependencies and **production impact**.
7. Formulate a plan before implementation (required for non-trivial changes).

Before destructive operations, agents **must not** without explicit human approval:

- Delete major directories or production integrations
- Delete or rewrite database migrations that may be applied in production
- Rotate secrets or modify production infrastructure
- Remove apparently unused code without verification (classify as LEGACY/UNKNOWN first)
- Replace core architecture (`server.js` split, auth model, wallet logic)
- Rewrite large portions of the codebase in a cleanup PR

Before committing:

1. Run the lane test gate (see lane contract).
2. Inspect `git diff` — no secrets, no accidental files, no unrelated changes.
3. Update relevant documentation if contracts or behavior changed.
4. Distinguish **documentation-only** PRs from **behavioral** PRs.

Distinguish documentation work from architectural rewrites. Governance PRs must not change runtime behavior.
