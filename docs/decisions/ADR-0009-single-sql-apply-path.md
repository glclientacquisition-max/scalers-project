---
owner: platform
last_reviewed: 2026-10-14
---

# ADR-0009: One SQL apply path: supabase/migrations

- **Status:** proposed (Alvin approves)
- **Date:** 2026-10-14
- **Deciders:** Alvin Yegon; platform

## Context and problem statement

SQL lives in two places: 66 files in `docs/supabase/` (manual apply, ledger) and 15 in `supabase/migrations/`. ADR-0003 chose manual SQL. Apply-order docs exist in both `how-to/DATABASE_APPLY_ORDER.md` and `docs/supabase/README.md`. Deferred: step 6 waits until BA v2 is on staging.

## Considered options

1. Move to `supabase/migrations/<timestamp>_name.sql` as the only apply path; `docs/supabase/` keeps the ledger and pointers
2. Keep both, document which wins
3. Keep manual SQL only

## Decision outcome

Proposed: Option 1, executed after BA v2 is on staging. Would supersede ADR-0003 when accepted.

### Confirmation

CI fails if `supabase/migrations/**` changes without regenerating `docs/reference/schema.md`.
