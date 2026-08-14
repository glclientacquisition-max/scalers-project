# ADR-0002 — Five-lane agent governance model

## Status

**Accepted**

## Context

Scalers development accelerated with multiple parallel AI and human contributors editing overlapping files (`server.js`, `src/db.js`, `dashboard/`, SQL). Merge conflicts and lane violations risked voice regressions and schema drift.

`AGENTS.md` and `docs/agents/{VOICE,BRAIN,DESK_UX,OPS_BILLING,PLATFORM}.md` were introduced with `.cursor/rules/*.mdc` enforcement.

## Decision

Organize engineering into **five agent lanes**, each with:

- Explicit **owns** paths
- **Do not touch** boundaries
- Lane-specific **test gates**
- Rule: one task → one lane → one PR

Lanes: Voice, Brain, Desk UI/UX, Ops & Billing, Platform.

Schema/RPC changes require Platform first.

## Alternatives considered

| Alternative | Why not |
| --- | --- |
| Single mega-agent / no lanes | Observed `server.js` conflict risk |
| File-type-only ownership (all TS vs JS) | Does not match product boundaries |
| Microservices per lane | Premature for current team size |

## Consequences

- Parallel work is safer when lanes respect contracts.
- `server.js` remains a known choke point for Voice lane.
- Governance docs (Phase 2) extend but do not replace lane contracts.

## Date

2026-08-13 — 2026-08-14 (lane docs and design mandate PRs #147–#150)

## Related systems

- [`../../AGENTS.md`](../../AGENTS.md)
- `docs/agents/*.md`, `.cursor/rules/*.mdc`
- [`../governance/DEVELOPMENT_WORKFLOW.md`](../governance/DEVELOPMENT_WORKFLOW.md)
