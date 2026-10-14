---
owner: platform
last_reviewed: 2026-10-14
---

# Docs

Index for the repo. Layout follows [Diataxis](https://diataxis.fr): learn in `tutorials/`, do a task in `how-to/`, look up facts in `reference/`, understand why in `explanation/`. Decisions are ADRs in `decisions/`, proposals in `rfcs/`, alert responses in `runbooks/`. Current state lives **only** in [`STATUS.md`](STATUS.md).

## Read first

| Doc | Use it for |
| --- | --- |
| [`STATUS.md`](STATUS.md) | **Start here.** Where we are now, what's done, in flight, and next |
| [`tutorials/getting-started.md`](tutorials/getting-started.md) | First hour for a new human or agent |
| [`../AGENTS.md`](../AGENTS.md) | Agent rules, commands, lane map |
| [`../README.md`](../README.md) | What is live, how to run voice and Desk |
| [`../CONTEXT.md`](../CONTEXT.md) | Glossary |
| [`explanation/architecture/SYSTEM_ARCHITECTURE.md`](explanation/architecture/SYSTEM_ARCHITECTURE.md) | How voice, Desk, and Supabase fit together |
| [`explanation/governance/SOURCE_OF_TRUTH.md`](explanation/governance/SOURCE_OF_TRUTH.md) | Which file is canonical |

## Folders

| Folder | Contents | Owner |
| --- | --- | --- |
| `tutorials/` | Onboarding paths | platform |
| `how-to/` | Deploy, staging, release, DID pool, DB apply order, tunnel, MVP test | lane in frontmatter |
| `reference/lanes/` | Lane contracts (Voice, Brain, Desk, Ops & Billing, Platform), prompts, turn contract | each lane |
| `reference/` (other) | Env, packages, design system, acceptance checklists, call message contract, **generated** [`schema.md`](reference/schema.md) and [`env.md`](reference/env.md) | lane / CI |
| `explanation/` | Architecture, product models, voice quality, billing model, governance, company brain | lane |
| `decisions/` | ADRs ([MADR template](decisions/TEMPLATE.md)). New ADRs start `status: proposed`; Alvin accepts. | proposing lane |
| `rfcs/` | Specs and design proposals before build (was `specs/`) | author lane |
| `runbooks/` | One per ops alert kind | ops-billing / platform |
| `archive/` | Superseded or dated docs, each with a pointer | none (history) |
| `supabase/` | Manual SQL + ledger. Apply order: [`supabase/README.md`](supabase/README.md). Consolidation with `supabase/migrations/` is deferred (step 6). | platform |
| `database/` | `staging_schema_manifest.json` only (read by `scripts/verify-staging-schema.js`) | platform |

## Rules

- Every doc starts with `owner` and `last_reviewed` frontmatter. CI warns after 90 days.
- Link, don't copy. One source of truth per fact.
- `reference/schema.md` and `reference/env.md` are generated: `npm run docs:reference`. Do not edit by hand.
- Code in `src/` and `dashboard/` still has a few comments naming old doc paths (`docs/agents/…`, `docs/specs/…`, `docs/frontend/…`). Map: [`reference/moved-paths.md`](reference/moved-paths.md).
