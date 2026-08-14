# ADR-0003 — Manual SQL script governance

## Status

**Accepted** — Reconstructed historical decision

## Context

Scalers migrated from SQLite to Supabase during rapid MVP development. The team needed additive schema changes (multi-tenant, wallet, DID pool, pronunciation, retail catalog) without a formal migration runner in the repository.

Result: 31 SQL files in `docs/supabase/` with human-maintained apply order (`docs/supabase/README.md`).

## Decision

Govern database schema through:

1. **Hand-authored SQL files** in `docs/supabase/`
2. **Documented apply order** with dependency tiers
3. **Idempotent scripts** where possible
4. **`schema.sql` as reference only** — not an apply migration
5. **Stable `src/db.js` API** — lanes consume DB through Platform contract

Manual application via Supabase SQL Editor or `psql`.

## Alternatives considered

| Alternative | Status |
| --- | --- |
| Supabase CLI migrations in repo | Not adopted — **future project** |
| ORM migrations (Prisma, etc.) | Not used |
| Edit `schema.sql` as single source | Rejected — reference only |

## Consequences

- Production migration state is **unknown without external audit** (see TD-P0-2).
- `src/db.js` uses progressive SELECT fallbacks — masks partial migrations.
- Platform lane must serialize wallet SQL apply order strictly.
- Supabase CLI adoption requires live DB audit before cutover.

## Date

Reconstructed: 2026-08-14 (scripts accumulated August 2026)

## Related systems

- [`../database/DATABASE_GOVERNANCE.md`](../database/DATABASE_GOVERNANCE.md)
- [`../supabase/README.md`](../supabase/README.md)
- `src/db.js`
