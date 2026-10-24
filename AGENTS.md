# Scalers agent lanes

> **New agent? Start at [`docs/STATUS.md`](docs/STATUS.md)**: where we are, what's done, what's in flight, and what's next.

Specialized Cursor agents / chats. One task → one lane → one PR.

| Lane | Scope | Contract |
| --- | --- | --- |
| **Voice** | Telephony media, STT/TTS, turn-taking, call latency | [`docs/reference/lanes/VOICE.md`](docs/reference/lanes/VOICE.md) · speed plan: [`VOICE_SPEED_CONSISTENCY.md`](docs/explanation/voice/VOICE_SPEED_CONSISTENCY.md) · live findings: [`LIVE_CALL_FINDINGS.md`](docs/archive/LIVE_CALL_FINDINGS.md) · pronunciation: [`PRONUNCIATION.md`](docs/explanation/voice/PRONUNCIATION.md) · ChapterOne setup: [`CHAPTERONE_SETUP_REVIEW.md`](docs/archive/CHAPTERONE_SETUP_REVIEW.md) |
| **Brain** | Prompts, conversation logic, tools, knowledge compile | [`docs/reference/lanes/BRAIN.md`](docs/reference/lanes/BRAIN.md) · caller CX gaps: [`docs/explanation/brain/CALLER_EXPERIENCE_EXCELLENCE.md`](docs/explanation/brain/CALLER_EXPERIENCE_EXCELLENCE.md) |
| **Desk UI/UX** | Owner desk + marketing UI | [`docs/reference/lanes/DESK_UX.md`](docs/reference/lanes/DESK_UX.md) |
| **Ops & Billing** | Wallet, DID pool, Super Admin | [`docs/reference/lanes/OPS_BILLING.md`](docs/reference/lanes/OPS_BILLING.md) |
| **Platform** | DB surface, auth/RLS, deploy, shared contracts | [`docs/reference/lanes/PLATFORM.md`](docs/reference/lanes/PLATFORM.md) |

**Copy-paste chat starters:** [`docs/reference/lanes/PROMPTS.md`](docs/reference/lanes/PROMPTS.md)

## Commands (Node 22)

| What | Command |
| --- | --- |
| Install | `npm ci` (root) and `cd dashboard && npm ci` |
| Voice gate | `npm run test:voice` |
| Brain gate | `npm run test:brain` |
| MVP gate | `npm run test:mvp` |
| Stage-PR changes | `npm run test:stage-pr` |
| Desk gate | `cd dashboard && npm run lint && npm run build` |
| Docs | `npm run docs:check` (frontmatter, stale > 90 days warns) · `npm run docs:reference` (regenerate `docs/reference/schema.md` + `env.md`) |

Nested rules: [`src/AGENTS.md`](src/AGENTS.md) (Voice runtime + Brain), [`dashboard/AGENTS.md`](dashboard/AGENTS.md) (Desk + Super Admin). The nearest `AGENTS.md` wins. `CLAUDE.md` files only import these (`@AGENTS.md`).

## Docs layout

`docs/STATUS.md` is the only place for current state; update it in the same PR as any merge to `main`. CI check `status-md` (`.github/workflows/status-md.yml`) fails a PR into `main` that does not change `docs/STATUS.md`; the only escape is the `no-status-update` label, for typo-only or CI-only PRs. Everything else follows Diataxis: `tutorials/`, `how-to/`, `reference/` (lane contracts in `reference/lanes/`; `schema.md` and `env.md` are generated, do not hand-edit), `explanation/`, `decisions/` (MADR ADRs, start `proposed`, Alvin accepts), `rfcs/`, `runbooks/` (one per ops alert kind), `archive/`. Every doc has `owner` + `last_reviewed` frontmatter.

## Do not

- Merge to `main`, write to prod (SQL, env, Railway/Vercel settings), release a DID, or rotate secrets without Alvin's explicit yes.
- Print, paste, or commit secrets. Docs list variable names only.
- Force-push. Never touch prod DID `+254709221536` (Aris).
- Set `VOICE_GEMINI_CATALOGUE` or `BRAIN_GEMINI_CATALOGUE`.
- Merge a PR into `main` that does not update `docs/STATUS.md` (what merged, prod vs staging, flags, open drafts, decisions), unless it carries the `no-status-update` label.

## Rules of engagement

1. Stay inside your lane’s **owns** paths. Ask Platform before changing `src/db.js` API or Supabase SQL.
2. Do not run parallel agents that both edit `server.js` heavily.
3. Paste the lane prompt from `docs/reference/lanes/PROMPTS.md` (or `@docs/reference/lanes/…`) at the start of each new chat.
4. Prefer fresh chats per ticket; do not keep one eternal mega-thread.
5. Schema / RPC / auth contract changes: **Platform first**, then feature lanes.
6. `.github/workflows/stage-pull-request.yml` rebuilds `cursor/staging-voice-468b` as `main` plus every open pull request (once that workflow is on `main`). Open the pull request into `main` so the rebuild starts immediately. A pull request into another feature branch joins on the next rebuild. Closing a pull request removes it from staging. A Stage-PR hold (`STAGE_PR_HOLD` or the `hold-staging` label) skips that rebuild's push and the Railway reconnect so a pinned staging Voice stays put. See [`docs/reference/operations/ENVIRONMENTS.md`](docs/reference/operations/ENVIRONMENTS.md#hold-staging-voice). Promote by squash-merging the tested feature pull request into `main`.

---

## Documentation map (governance baseline)

| Doc | Purpose |
| --- | --- |
| [`README.md`](README.md) | What Scalers is, how to run it, short repo map |
| [`docs/README.md`](docs/README.md) | Doc folder index |
| [`docs/explanation/architecture/SYSTEM_ARCHITECTURE.md`](docs/explanation/architecture/SYSTEM_ARCHITECTURE.md) | How voice, Desk, and Supabase fit together |
| [`docs/explanation/architecture/CURRENT_STATE.md`](docs/explanation/architecture/CURRENT_STATE.md) | File-level facts (Aug 2026 baseline, later corrections marked) |
| [`docs/reference/platform/PLATFORM_SYSTEM_MAP.md`](docs/reference/platform/PLATFORM_SYSTEM_MAP.md) | Platform as-is map: voice, notify, WhatsApp, wallet, Brain SoR, ladder jobs |
| [`docs/explanation/governance/SOURCE_OF_TRUTH.md`](docs/explanation/governance/SOURCE_OF_TRUTH.md) | Subsystem ownership |
| [`docs/how-to/DEVELOPMENT_WORKFLOW.md`](docs/how-to/DEVELOPMENT_WORKFLOW.md) | Branching, lifecycle, PR checklist |
| [`docs/explanation/governance/SCALERS_ENGINEERING_PRINCIPLES.md`](docs/explanation/governance/SCALERS_ENGINEERING_PRINCIPLES.md) | Permanent engineering rules |
| [`docs/reference/lanes/AGENT_ARCHITECTURE.md`](docs/reference/lanes/AGENT_ARCHITECTURE.md) | AI agent stack on live calls |
| [`docs/archive/LIVE_TRANSFER.md`](docs/archive/LIVE_TRANSFER.md) | Live human Dial (archived: callbacks only since #658) |
| [`docs/explanation/product/ESCALATION.md`](docs/explanation/product/ESCALATION.md) | Async human notify (shipped) |
| [`docs/explanation/database/DATABASE_GOVERNANCE.md`](docs/explanation/database/DATABASE_GOVERNANCE.md) | Manual SQL model |
| [`docs/archive/FRONTEND_RECONNAISSANCE.md`](docs/archive/FRONTEND_RECONNAISSANCE.md) | Desk Frontend 2.0 recon (no UI until constitution) |

---

## AI agent safety protocol (all lanes)

Before changing code:

1. Read this file and the **lane contract** for your task (`docs/reference/lanes/{LANE}.md`).
2. Read [`docs/explanation/architecture/CURRENT_STATE.md`](docs/explanation/architecture/CURRENT_STATE.md) and [`docs/explanation/governance/SOURCE_OF_TRUTH.md`](docs/explanation/governance/SOURCE_OF_TRUTH.md).
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

## Agent skills

Composable Matt Pocock skills in `.cursor/skills/` (grill-with-docs, wayfinder, tdd, code-review) plus **desk-motion**, **reticle**, **chisle**, and **ui-skills**. `npx skills` packs, including **no-ai-slop**, **ui-taste**, and **ios-design**, live in `.agents/skills/` and are linked from `.cursor/skills/`. Charter, MASTER, and desk-motion win over those packs. They do **not** replace lanes. Index: [`.cursor/skills/README.md`](.cursor/skills/README.md).

Before presenting desk or admin UI work, run `/impeccable` (`impeccable context`, then Operate: critique or detect) and `/no-ai-slop` on new strings. The Frontend 2.0 charter still wins over Impeccable taste.

**Universal app (every chat, every lane that touches UI):** treat owner desk and Super Admin like a phone product, not a vendor console. People, money, status. No Resend/DNS/API-key/env controls on product screens. Escalate contacts are name, phone, email. Copy is nouns the operator already knows. These rules apply in this chat and in later chats.

### Issue tracker

GitHub for humans; Cloud Agents write specs under `docs/rfcs/` (read-only `gh`). See `docs/reference/lanes/issue-tracker.md`.

### Domain docs

Single-context glossary at `CONTEXT.md`. ADRs live in `docs/decisions/` (MADR). Lane contracts live in `docs/reference/lanes/`. See `docs/reference/lanes/domain.md`.

