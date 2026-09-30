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
STAGING       — rebuild `cursor/staging-voice-468b` as `main` plus open PRs
  ↓
BETA          — beta tenants; billing_enforcement=off default
  ↓
PRODUCTION    — squash-merge that tested PR into `main`
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

## Staging branch (Desk + Voice)

One integration branch: **`cursor/staging-voice-468b`**. Not a second git repo.

| App | Follows | Official URL |
| --- | --- | --- |
| Staging Voice | Railway `scalers staging` → this branch | `https://scalers-staging-staging.up.railway.app` |
| Staging Desk | Vercel `scalers-staging` production deploys from this branch. Production builds from any other branch are ignored. | `https://scalers-staging.vercel.app` |
| Production Voice | Railway `scalers-project` → `main` | `https://scalers-project-production.up.railway.app` |
| Production Desk | Vercel `scalers-project` → `main` | `https://scalers-project.vercel.app` |

Day to day:

1. Feature branch (one lane). Open the pull request into `main` so the rebuild starts on open. A pull request into another feature branch is still staging work, and it joins on the next rebuild.
2. `.github/workflows/stage-pull-request.yml` rebuilds `cursor/staging-voice-468b` as `main` plus every open pull request. This starts after the workflow file is on `main`. Changing the pull request base to `main` starts a rebuild.
3. Staging Desk and staging Voice deploy from that branch. The stage workflow assigns `scalers-staging.vercel.app` to the ready deploy of that branch. Open that URL. For voice, confirm `/healthz.gitSha` is the staging branch tip from the pull request note, then call `+254709221536`.
4. If the test is good, mark that feature pull request ready and squash-merge it into `main`. Production Desk and production Voice follow `main`.
5. If the test is not good, close the pull request. The workflow rebuilds staging without it. The practice desk and practice phone go back to `main` plus the pull requests still open.
6. A preview URL on the feature pull request is a glance. The shared staging URL is `https://scalers-staging.vercel.app`.

Promote by squash-merging the tested pull request into `main`. The staging branch is only the practice copy.

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
