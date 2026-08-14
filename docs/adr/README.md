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
docs/adr/ADR-NNNN-short-kebab-title.md
```

Increment `NNNN` sequentially. Never reuse numbers.

---

## Template

```markdown
# ADR-NNNN — Title

## Status
Proposed | Accepted | Superseded | Deprecated

## Context
Why did this decision become necessary?

## Decision
What did we decide?

## Alternatives considered
What else did we consider?

## Consequences
What does this decision mean?

## Date
YYYY-MM-DD

## Related systems
...
```

---

## Reconstructed historical ADRs

ADRs marked **Reconstructed historical decision** were written after the fact from Git evidence and existing docs. They were not contemporary decision records.

| ADR | Title | Status |
| --- | --- | --- |
| [ADR-0001](./ADR-0001-sautikit-soniox-supabase.md) | SautiKit + Soniox + Supabase voice stack | Accepted (historical) |
| [ADR-0002](./ADR-0002-five-lane-agent-governance.md) | Five-lane agent governance model | Accepted |
| [ADR-0003](./ADR-0003-manual-sql-governance.md) | Manual SQL script governance | Accepted (historical) |

---

## Process

1. Author proposes ADR in PR (Status: Proposed).
2. Platform + affected lane owners review.
3. Merge with Status: Accepted.
4. If superseded, update old ADR status and link to new ADR.

---

## Related documents

- [`../governance/SCALERS_ENGINEERING_PRINCIPLES.md`](../governance/SCALERS_ENGINEERING_PRINCIPLES.md)
- [`../governance/PROJECT_HISTORY.md`](../governance/PROJECT_HISTORY.md)
