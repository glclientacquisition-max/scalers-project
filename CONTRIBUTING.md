# Contributing to Scalers

Thank you for contributing. Scalers is a voice AI receptionist with a **voice engine** (Node.js), **owner desk** (Next.js), and **Supabase** backend. Read this before opening a PR.

**AI agents:** Start with [`AGENTS.md`](AGENTS.md) and the lane contract for your task.

---

## Before you code

1. Read [`AGENTS.md`](AGENTS.md) — pick **one lane** per PR (Voice, Brain, Desk UI/UX, Ops & Billing, Platform).
2. Read [`docs/architecture/CURRENT_STATE.md`](docs/architecture/CURRENT_STATE.md) and [`docs/governance/SOURCE_OF_TRUTH.md`](docs/governance/SOURCE_OF_TRUTH.md).
3. Check `git status` and branch from up-to-date `main`.
4. Plan non-trivial changes before implementing (see [`docs/governance/DEVELOPMENT_WORKFLOW.md`](docs/governance/DEVELOPMENT_WORKFLOW.md)).

---

## Branch naming

Use these prefixes for **new** work:

| Prefix | Use |
| --- | --- |
| `feature/*` | New functionality |
| `fix/*` | Bug fixes |
| `refactor/*` | Structure without intended behavior change |
| `experiment/*` | Non-production spikes |
| `hotfix/*` | Urgent production fixes |

**Cursor cloud agents** may use `cursor/<descriptive-name>-d058` (see [`docs/governance/BRANCH_LIFECYCLE.md`](docs/governance/BRANCH_LIFECYCLE.md)).

Do not rename existing historical `cursor/*` branches.

`main` is stable, production-capable code.

---

## Development lifecycle

```
IDEA → PLAN → BRANCH → IMPLEMENT → TEST → PR → REVIEW → MERGE
```

Full lifecycle (including beta/production): [`docs/governance/DEVELOPMENT_WORKFLOW.md`](docs/governance/DEVELOPMENT_WORKFLOW.md).

**Rules:**

- One lane per PR. Do not mix voice media changes with desk redesigns.
- Schema/RPC changes: **Platform first**, then feature lanes.
- Do not run parallel work that both edits `server.js` heavily.

---

## Pull requests

- Fill out the [PR template](.github/pull_request_template.md) completely.
- Keep PRs focused. No unrelated drive-by changes.
- Use [Conventional Commits](https://www.conventionalcommits.org/) where practical (`feat:`, `fix:`, `docs:`, `ci:`, etc.).
- Draft PRs are fine for work in progress.

---

## Testing requirements

CI runs on every PR to `main` (see [`.github/workflows/ci.yml`](.github/workflows/ci.yml)):

| Command | Scope |
| --- | --- |
| `npm run test:voice` | Voice lane |
| `npm run test:brain` | Brain unit tests |
| `npm run test:mvp` | MVP gate (brain + knowledge + smokes) |
| `cd dashboard && npm run build` | Desk production build |

**Run locally before pushing:**

```bash
npm ci && npm run test:voice && npm run test:brain && npm run test:mvp
cd dashboard && npm ci && npm run build
```

**Lane-specific gates** (also run when touching that area):

| Lane | Additional gate |
| --- | --- |
| Voice | `npm run test:voice` |
| Brain | `npm run test:mvp` |
| Desk UI/UX | `npm run build` (lint: known pre-existing failure — see below) |
| Platform | SQL review; `npm run smoke:db` when Supabase env available |

**Known baseline issue (does not block CI):** `cd dashboard && npm run lint` fails on a pre-existing unused variable in `retailOnboardingPack.ts`. Fix in a dedicated `fix/*` PR. See [`docs/governance/TESTING_BASELINE.md`](docs/governance/TESTING_BASELINE.md).

Do not weaken tests or delete failing tests to make CI green.

---

## Documentation expectations

- **Behavior or contract changes:** update relevant docs in the same PR.
- **Architecture decisions:** add an ADR under `docs/adr/` (see [`docs/adr/README.md`](docs/adr/README.md)).
- **SQL changes:** update [`docs/supabase/README.md`](docs/supabase/README.md) apply order.
- **Docs-only PRs:** must not change runtime behavior.

Governance index: [`docs/governance/SCALERS_ENGINEERING_PRINCIPLES.md`](docs/governance/SCALERS_ENGINEERING_PRINCIPLES.md).

---

## Database changes

Scalers uses **manual SQL scripts** in `docs/supabase/` — not Supabase CLI migrations (yet).

1. Coordinate with **Platform** lane before new RPCs or RLS changes.
2. Add additive SQL with header noting predecessor scripts.
3. Insert into apply order in `docs/supabase/README.md`.
4. Never edit scripts that may already be applied in production — add a new script instead.
5. See [`docs/database/DATABASE_GOVERNANCE.md`](docs/database/DATABASE_GOVERNANCE.md).

---

## AI-assisted development

Cursor and other AI agents must follow [`AGENTS.md`](AGENTS.md) safety protocol:

- Inspect before modifying; identify source of truth.
- No destructive operations without explicit human approval.
- No secrets in commits. Never put service role keys in `NEXT_PUBLIC_*`.
- Distinguish documentation PRs from behavioral changes.
- Paste the lane prompt from [`docs/agents/PROMPTS.md`](docs/agents/PROMPTS.md) at the start of agent sessions.

---

## What not to do

- Force-push or rewrite `main` history without explicit approval.
- Bulk-delete `cursor/*` remote branches without merge verification.
- Mix unrelated refactors into feature PRs.
- Change production behavior in a "cleanup" or "docs" PR.

---

## Questions

- Architecture: [`docs/architecture/CURRENT_STATE.md`](docs/architecture/CURRENT_STATE.md)
- Deploy: [`docs/operations/DEPLOYMENT.md`](docs/operations/DEPLOYMENT.md)
- Release: [`docs/governance/RELEASE_PROCESS.md`](docs/governance/RELEASE_PROCESS.md)
