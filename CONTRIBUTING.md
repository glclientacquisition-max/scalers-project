# Contributing to Scalers

Thank you for contributing. Scalers is a Kenya Business Assistant: a Node.js voice engine, a Next.js Desk, and Supabase. Read this before opening a PR.

Repo map: [`README.md`](README.md). Doc index: [`docs/README.md`](docs/README.md).

**AI agents:** Start with [`AGENTS.md`](AGENTS.md) and the lane contract for your task.

---

## Before you code

1. Read [`AGENTS.md`](AGENTS.md) — pick **one lane** per PR (Voice, Brain, Desk UI/UX, Ops & Billing, Platform).
2. Read [`docs/explanation/architecture/CURRENT_STATE.md`](docs/explanation/architecture/CURRENT_STATE.md) and [`docs/explanation/governance/SOURCE_OF_TRUTH.md`](docs/explanation/governance/SOURCE_OF_TRUTH.md).
3. Check `git status` and branch from up-to-date `main`.
4. Plan non-trivial changes before implementing (see [`docs/how-to/DEVELOPMENT_WORKFLOW.md`](docs/how-to/DEVELOPMENT_WORKFLOW.md)).

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

**Cursor cloud agents** may use `cursor/<descriptive-name>-d058` (see [`docs/how-to/BRANCH_LIFECYCLE.md`](docs/how-to/BRANCH_LIFECYCLE.md)).

Do not rename existing historical `cursor/*` branches.

`main` is stable, production-capable code.

---

## Development lifecycle

```
IDEA → PLAN → BRANCH → IMPLEMENT → TEST → PR → REVIEW → MERGE
```

Full lifecycle (including beta/production): [`docs/how-to/DEVELOPMENT_WORKFLOW.md`](docs/how-to/DEVELOPMENT_WORKFLOW.md).

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

**Known baseline issue (does not block CI):** `cd dashboard && npm run lint` fails on a pre-existing unused variable in `retailOnboardingPack.ts`. Fix in a dedicated `fix/*` PR. See [`docs/reference/governance/TESTING_BASELINE.md`](docs/reference/governance/TESTING_BASELINE.md).

Do not weaken tests or delete failing tests to make CI green.

---

## Documentation expectations

- **Behavior or contract changes:** update relevant docs in the same PR.
- **Architecture decisions:** add an ADR under `docs/decisions/` (see [`docs/decisions/README.md`](docs/decisions/README.md)).
- **SQL changes:** update [`docs/supabase/README.md`](docs/supabase/README.md) apply order.
- **Docs-only PRs:** must not change runtime behavior.

### STATUS rule

Every PR that merges to `main` updates [`docs/STATUS.md`](docs/STATUS.md) in the same PR: the "Last updated" line, section 2 (shipped) and any row in sections 3 to 5 it changes. The CI check `status-md` (`.github/workflows/status-md.yml`) fails a PR into `main` whose diff does not include `docs/STATUS.md`. For a typo-only or CI-only PR that changes nothing live, add the label `no-status-update` instead and say "STATUS: no change" in the PR body.

### Doc frontmatter

Every Markdown file under `docs/` starts with YAML frontmatter:

```yaml
---
owner: platform        # one of: platform, voice, brain, desk, ops-billing
last_reviewed: 2026-10-14
---
```

Bump `last_reviewed` when you check a doc is still true. Docs older than 90 days are flagged by CI. Superseded docs move to `docs/archive/` with a pointer to what replaced them.

Governance index: [`docs/explanation/governance/SCALERS_ENGINEERING_PRINCIPLES.md`](docs/explanation/governance/SCALERS_ENGINEERING_PRINCIPLES.md).

---

## Database changes

Scalers uses **manual SQL scripts** in `docs/supabase/` — not Supabase CLI migrations (yet).

1. Coordinate with **Platform** lane before new RPCs or RLS changes.
2. Add additive SQL with header noting predecessor scripts.
3. Insert into apply order in `docs/supabase/README.md`.
4. Never edit scripts that may already be applied in production — add a new script instead.
5. See [`docs/explanation/database/DATABASE_GOVERNANCE.md`](docs/explanation/database/DATABASE_GOVERNANCE.md).

---

## AI-assisted development

Cursor and other AI agents must follow [`AGENTS.md`](AGENTS.md) safety protocol:

- Inspect before modifying; identify source of truth.
- No destructive operations without explicit human approval.
- No secrets in commits. Never put service role keys in `NEXT_PUBLIC_*`.
- Distinguish documentation PRs from behavioral changes.
- Paste the lane prompt from [`docs/reference/lanes/PROMPTS.md`](docs/reference/lanes/PROMPTS.md) at the start of agent sessions.

---

## What not to do

- Force-push or rewrite `main` history without explicit approval.
- Bulk-delete `cursor/*` remote branches without merge verification.
- Mix unrelated refactors into feature PRs.
- Change production behavior in a "cleanup" or "docs" PR.

---

## Questions

- Architecture: [`docs/explanation/architecture/CURRENT_STATE.md`](docs/explanation/architecture/CURRENT_STATE.md)
- Deploy: [`docs/how-to/DEPLOYMENT.md`](docs/how-to/DEPLOYMENT.md)
- Release: [`docs/how-to/RELEASE_PROCESS.md`](docs/how-to/RELEASE_PROCESS.md)
