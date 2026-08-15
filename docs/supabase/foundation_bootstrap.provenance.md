# Foundation bootstrap provenance

**Status:** Production-authoritative / historically-unverified  
**Artifact:** [`foundation_bootstrap.sql`](./foundation_bootstrap.sql)  
**Reconstruction date:** 2026-08-14  
**Production source:** ALCR (`fjxcdccgyhnvnnlnovcl`), PostgreSQL 17.6

---

## What this file is

`foundation_bootstrap.sql` reproduces the **current verified production shape** of:

- `public.tenants` (49 columns)
- `public.calls` (15 columns)
- `public.transcripts` (6 columns)

plus production-verified RLS policies, column grants, and the `tenants_protect_wallet_columns` trigger.

It is a **reference/bootstrap artifact** for staging and greenfield reproducibility.

## What this file is NOT

- **NOT** the recovered historical `CREATE TABLE` from project inception.
- **NOT** safe to apply to ALCR production (tables already exist).
- **NOT** derived from application code (`src/db.js`) or stale `schema.sql` comments alone.
- **NOT** based on commit `9153a09` (Aug 6 2026), which contained a superseded CREATE TABLE with different column names, defaults (`gen_random_uuid()`), FK actions, and a one-row-per-call transcripts model.

Original foundation DDL provenance remains **UNKNOWN**.

---

## Methodology (Phase 3D-4)

Read-only catalog introspection against production ALCR:

| Source | Used for |
| --- | --- |
| `information_schema.columns` | Column names, types, nullability, defaults |
| `pg_constraint` | PK, FK, UNIQUE, CHECK definitions |
| `pg_indexes` | Index inventory |
| `pg_policies` | RLS policy names and expressions |
| `information_schema.table_privileges` | Table grants |
| `information_schema.column_privileges` | Column-scoped UPDATE grants |
| `pg_trigger` / `pg_proc` | Trigger and function bodies |
| `pg_description` | Column comments |

No row-level queries. No production mutations.

---

## Extension dependencies

| Extension | In bootstrap | Notes |
| --- | --- | --- |
| `uuid-ossp` | **YES** | Required for `uuid_generate_v4()` PK defaults |
| `pgcrypto` | **NO** | Present on production (1.3) but not required by these three tables |

---

## Known production gaps documented in bootstrap

| Item | Status |
| --- | --- |
| `tenants.notify_channels` authenticated UPDATE grant | Missing in production; commented fix in bootstrap |
| Secondary indexes (`calls.tenant_id`, `calls.created_at`, `transcripts.call_id`) | Not present in production; not included |
| `storage.buckets` `call-recordings` | Created 2026-08-06; provenance UNKNOWN; not in this file |
| Legacy `"Enable all access for service role only"` RLS | Absent post-P0; must not be reintroduced |

---

## Apply guidance (greenfield)

1. Create Supabase project with Auth enabled.
2. Run `foundation_bootstrap.sql` (requires `auth.users`; RLS section requires `current_user_tenant_ids()` from `owner_rls.sql`).
3. Run `multi_tenant_onboarding.sql` (creates `tenant_members`, signup trigger; `owner_user_id` column is already in bootstrap).
4. Run `owner_rls.sql` if `current_user_tenant_ids()` is not yet present.
5. Continue `docs/supabase/README.md` apply order. Additive `ALTER TABLE … ADD COLUMN` scripts should no-op.

---

## Related documents

- [`MIGRATION_LEDGER.md`](./MIGRATION_LEDGER.md) — dual migration model and column lineage
- [`README.md`](./README.md) — full apply order
- [`../governance/HISTORY_GAPS.md`](../governance/HISTORY_GAPS.md) — what remains unknown
