---
owner: platform
last_reviewed: 2026-10-14
---

# ADR-0008: AGENTS.md is the single agent entry point

- **Status:** accepted (Alvin, 2026-10-14)
- **Date:** 2026-10-14
- **Deciders:** Alvin Yegon; platform

## Context and problem statement

Rules for agents were spread across `AGENTS.md`, `.cursor/rules/*.mdc`, lane contracts and workflow skills outside git. Different tools read different files.

## Considered options

1. Root `AGENTS.md` + one per app (`src/`, `dashboard/`); `CLAUDE.md` is `@AGENTS.md`; Cursor rules and skills link to these
2. Keep per-tool files with copied rules
3. Only `.cursor/rules`

## Decision outcome

Accepted: Option 1. The nearest `AGENTS.md` wins (agents.md spec), one copy of each rule, tool-specific files stay thin.

### Confirmation

Review rule: a PR that changes a lane rule edits `AGENTS.md` or the lane contract, not a copy.
