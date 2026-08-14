# Development workflow

**Status:** Governance baseline (2026-08-14)  
**Applies to:** New work from this date forward. Does not rename existing `cursor/*` branches.

---

## Lifecycle

```
IDEA
  ↓
PLAN          — scope, lane, source of truth, risks (required for non-trivial work)
  ↓
FEATURE BRANCH — feature/*, fix/*, refactor/*, experiment/*, or hotfix/*
  ↓
IMPLEMENT     — stay inside lane owns paths
  ↓
TEST          — lane test gates (see below)
  ↓
REVIEW        — PR with clear description; no unrelated changes
  ↓
STAGING       — UNKNOWN today (see ../operations/ENVIRONMENTS.md)
  ↓
BETA          — beta tenants; billing_enforcement=off default
  ↓
PRODUCTION    — Railway voice + Vercel desk promote
```

For AI agents, the mandatory sequence for significant changes:

```
DISCOVER → UNDERSTAND → PLAN → PROPOSE → IMPLEMENT → TEST → REVIEW → DOCUMENT → COMMIT
```

---

## Agent lanes (existing — preserved)

Pick **one lane per PR**. Full contracts: `AGENTS.md` + `docs/agents/{LANE}.md`.

| Lane | Owns | Test gate |
| --- | --- | --- |
| Voice | `server.js` media path, `src/speech/`, `src/sautikit/` | `npm run test:voice` |
| Brain | `src/prompts.js`, `src/conversation/`, prompt compile | `npm run test:brain`, `npm run test:mvp` |
| Desk UI/UX | `dashboard/` owner/marketing UX | `cd dashboard && npm run lint && npm run build` |
| Ops & Billing | Wallet, DID, Super Admin | SQL review + ops smoke |
| Platform | `docs/supabase/`, `src/db.js`, auth, deploy | `npm run smoke:db` (when env set), desk build |

**Rule:** Schema/RPC changes → Platform first, then feature lanes.  
**Rule:** Do not run parallel agents that both edit `server.js` heavily.

---

## Branch conventions (new work)

| Prefix | Use | Example |
| --- | --- | --- |
| `feature/*` | New functionality | `feature/agent-snapshot-schema` |
| `fix/*` | Bug fixes | `fix/duplicate-booking-notify` |
| `refactor/*` | Structure without intended behavior change | `refactor/extract-voice-routes` |
| `experiment/*` | Non-production spikes | `experiment/openai-tts-eval` |
| `hotfix/*` | Urgent production fixes | `hotfix/call-routing-500` |

**Historical branches:** Existing `cursor/*` branches are not renamed. Cloud agents may continue `cursor/<name>-d058` pattern until explicitly migrated.

`main` is stable, production-capable code.

---

## Commit conventions

Prefer [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add call agent snapshot column
fix: prevent duplicate wallet charge
refactor: extract voice event handlers
docs: document current call architecture
test: add escalation notify coverage
chore: establish governance baseline
ci: add voice and mvp test workflow
```

Commits should be focused, understandable, and reversible.

---

## Pull request checklist

- [ ] Single lane scope (or Platform contract with lane sign-off)
- [ ] Lane test gates run and results noted
- [ ] No secrets in diff
- [ ] No unrelated file changes
- [ ] Documentation updated if behavior or contracts changed
- [ ] SQL changes: new additive file + README order updated

---

## Planning template (significant changes)

```
Objective:
Current behavior:
Proposed behavior:
Files affected:
Dependencies:
Risks:
Testing:
Rollback:
Documentation:
```

High-risk areas (require explicit human approval before implementation):

- `server.js` modularization
- Database schema / RLS
- Authentication model
- Wallet / billing / DID logic
- Voice media path / barge-in
- Merging JS/TS duplicate implementations

---

## Related documents

- [`RELEASE_PROCESS.md`](./RELEASE_PROCESS.md)
- [`TESTING_BASELINE.md`](./TESTING_BASELINE.md)
- [`SCALERS_ENGINEERING_PRINCIPLES.md`](./SCALERS_ENGINEERING_PRINCIPLES.md)
- [`../../AGENTS.md`](../../AGENTS.md)
