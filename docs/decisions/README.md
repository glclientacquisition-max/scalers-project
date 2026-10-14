---
owner: platform
last_reviewed: 2026-10-14
---

# Architecture Decision Records (ADR)

**Status:** Governance baseline (2026-08-14)

ADRs document **significant architectural decisions** — why Scalers chose a path, what alternatives were considered, and what consequences follow.

---

## When to write an ADR

Create a new ADR when a decision:

- Changes telephony, voice pipeline, database contract, auth, or billing model
- Introduces a new external dependency or removes one
- Affects multiple agent lanes
- Is hard to reverse

Do **not** write ADRs for routine bug fixes or UI polish.

---

## File naming

```
docs/decisions/ADR-NNNN-short-kebab-title.md
```

Increment `NNNN` sequentially. Never reuse numbers.

---

## Template

Use [MADR](https://adr.github.io/madr/): copy [`TEMPLATE.md`](TEMPLATE.md). New ADRs start **Status: proposed**. Only Alvin moves an ADR to accepted.

---

## Reconstructed historical ADRs

ADRs marked **Reconstructed historical decision** were written after the fact from Git evidence and existing docs. They were not contemporary decision records.

| ADR | Title | Status |
| --- | --- | --- |
| [ADR-0001](ADR-0001-sautikit-soniox-supabase.md) | SautiKit + Soniox + Supabase voice stack | Accepted (historical) |
| [ADR-0002](ADR-0002-five-lane-agent-governance.md) | Five-lane agent governance model | Accepted |
| [ADR-0003](ADR-0003-manual-sql-governance.md) | Manual SQL script governance | Superseded by ADR-0009 |
| [ADR-0004](ADR-0004-live-human-transfer.md) | Live human transfer via cold Dial after Stream stop | Superseded by ADR-0007 |
| [ADR-0005](ADR-0005-returning-caller-card.md) | Returning-caller card at call setup | Accepted |
| [ADR-0006](ADR-0006-diataxis-docs-layout.md) | Docs follow Diataxis with ADRs, RFCs and runbooks | Accepted (2026-10-14) |
| [ADR-0007](ADR-0007-callbacks-only-handoff.md) | Human handoff is callbacks only | Accepted (2026-10-14) |
| [ADR-0008](ADR-0008-agents-md-entry-point.md) | AGENTS.md is the single agent entry point | Accepted (2026-10-14) |
| [ADR-0009](ADR-0009-single-sql-apply-path.md) | One SQL apply path: supabase/migrations (move deferred until v2 is on staging) | Accepted (2026-10-14) |

---

## Process

1. Author proposes ADR in PR (Status: proposed).
2. Platform + affected lane owners review.
3. Alvin approves; then Status: accepted.
4. If superseded, update old ADR status and link to new ADR.

---

## Related documents

- [`../governance/SCALERS_ENGINEERING_PRINCIPLES.md`](../explanation/governance/SCALERS_ENGINEERING_PRINCIPLES.md)
- [`../governance/PROJECT_HISTORY.md`](../explanation/governance/PROJECT_HISTORY.md)
