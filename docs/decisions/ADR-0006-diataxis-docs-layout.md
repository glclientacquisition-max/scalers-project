---
owner: platform
last_reviewed: 2026-10-14
---

# ADR-0006: Docs follow Diataxis with ADRs, RFCs and runbooks

- **Status:** proposed (Alvin approves)
- **Date:** 2026-10-14
- **Deciders:** Alvin Yegon; platform

## Context and problem statement

Docs grew to ~150 files across 18 folders (`agents/`, `ops/` vs `operations/`, `specs/` vs `product/` vs `acceptance/`). Agents and humans could not tell current facts from dated reports, and STATUS was four days stale. Audit: `/workspace/briefs/docs-structure-audit-platform.md` (outside git).

## Considered options

1. Diataxis folders (`tutorials/`, `how-to/`, `reference/`, `explanation/`) plus `decisions/`, `rfcs/`, `runbooks/`, `archive/`
2. Keep lane/area folders and only add frontmatter
3. Move docs into a separate docs site

## Decision outcome

Proposed: Option 1. It separates "why" from "steps", gives generated reference a home, and archive keeps history without polluting search.

### Confirmation

CI checks frontmatter, staleness and internal links (`docs.yml`).
