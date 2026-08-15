# Database evolution model

**Status:** Canonical governance (Phase 3F, 2026-08-15)  
**Audience:** Engineers who have never worked on Scalers  
**Production project:** ALCR (`fjxcdccgyhnvnnlnovcl`) — never modify without explicit approval

---

## Purpose

This document answers one question:

> When we add a new feature, exactly where does its database change live?

Scalers uses **two historical mechanisms** that coexist. This model does not replace either blindly. It defines how they work together going forward.

---

## Historical mechanisms

### A. Foundation bootstrap

| Property | Detail |
| --- | --- |
| Artifact | `docs/supabase/foundation_bootstrap.sql` |
| Responsibility | Current production shape of `tenants`, `calls`, `transcripts` |
| Provenance | Production catalog introspection (Phase 3D-4); original CREATE **UNKNOWN** |
| When to change | Only when production foundation tables change and bootstrap is re-introspected |
| Apply target | Greenfield / staging rebuild only — **never ALCR production** |

### B. Feature / additive SQL

| Property | Detail |
| --- | --- |
| Artifacts | `docs/supabase/<feature>.sql` (31 feature scripts + repairs) |
| Responsibility | All post-foundation schema: columns, tables, RPCs, RLS, grants |
| Apply method | Manual SQL Editor or `psql` (primary governance model) |
| Ordering | `docs/supabase/README.md` + `DATABASE_APPLY_ORDER.md` |

### C. Supabase CLI migrations (partial, production only)

| Property | Detail |
| --- | --- |
| Location | `supabase_migrations.schema_migrations` on ALCR (24 rows) |
| In repo | **No** `supabase/migrations/` folder |
| Role | Historical record on production; not replayed for greenfield |
| Greenfield path | Manual scripts only (proven Phase 3E on staging) |

---

## Canonical future model

### Responsibility matrix

| Concern | Owner artifact | Rule |
| --- | --- | --- |
| Foundation table shape | `foundation_bootstrap.sql` | Snapshot only; update after verified production introspection |
| New column on `tenants` | New or existing feature `.sql` | Additive `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` |
| New table | New `docs/supabase/<name>.sql` | FK must reference existing tables; document predecessor |
| New RPC | Feature `.sql` or wallet chain file | `SECURITY DEFINER` requires explicit `REVOKE`/`GRANT` |
| RLS policy | Feature `.sql` or `owner_rls.sql` | Must use `current_user_tenant_ids()` for owner scope |
| Column grants | Same file as column or wallet security | After `wallet_security_beta.sql` pattern for `tenants` |
| Apply order | `README.md` + `DATABASE_APPLY_ORDER.md` | Append; do not renumber historical production applies |
| Change record | `MIGRATION_LEDGER.md` | One entry per logical change |
| Application contract | `src/db.js` | Platform lane; progressive fallback is not a substitute for migration |

### When to use which path

```
New feature needs DB change?
│
├─ Touches tenants/calls/transcripts base CREATE?
│   └─ NO → use feature .sql only
│
├─ New greenfield environment?
│   ├─ foundation_bootstrap.sql (split apply — see APPLY_ORDER)
│   └─ then all feature scripts in order
│
├─ Existing production/staging?
│   └─ apply only the new feature .sql (if predecessors already applied)
│
└─ Record in MIGRATION_LEDGER.md before merge
```

---

## Migration ordering

1. **Extensions** (`uuid-ossp`, `pgcrypto` on Supabase by default)
2. **Foundation tables** (`foundation_bootstrap.sql` §1–4)
3. **Core tenant/auth** (`multi_tenant_onboarding.sql`, `owner_rls.sql`)
4. **Foundation RLS/grants/trigger** (`foundation_bootstrap.sql` §5–7)
5. **Feature tiers 2–9** per `README.md`
6. **Security repairs** (`fix_p0_rls_...` when migrating legacy projects)
7. **Storage buckets** (manual; not fully in Git)
8. **Seed fixtures** (DID pool rows, voice catalog — operational, not schema)
9. **Validation** (`smoke-db.js`, catalog queries)

**Rule:** Scripts within a tier run in README order. Never apply in parallel.

Full dependency graph: [`DATABASE_APPLY_ORDER.md`](./DATABASE_APPLY_ORDER.md).

---

## Naming convention

| Type | Pattern | Example |
| --- | --- | --- |
| Feature script | `<domain>_<concept>.sql` | `notify_channels.sql` |
| Fix / repair | `fix_<issue>.sql` | `fix_p0_rls_remove_legacy_allow_all.sql` |
| Wallet chain | `wallet_<concept>.sql` | `wallet_on_demand_alerts.sql` |
| Header comment | `-- Run after: <predecessor>.sql` | Required on every new file |

Do not use date-prefixed filenames in `docs/supabase/` unless adopting CLI migrations in a future phase.

---

## Rollback expectations

| Environment | Expectation |
| --- | --- |
| Production | **Forward-fix only.** No destructive `DROP TABLE` without Platform + Ops approval. |
| Staging | Rebuild from Git (drop project or fresh DB) preferred over partial rollback. |
| Local dev | Same as staging; disposable projects encouraged. |

Additive scripts should be idempotent (`IF NOT EXISTS`, `CREATE OR REPLACE`). Rollback SQL is not required in-repo today but breaking changes must include a forward-fix script.

---

## Staging application process

1. Merge feature branch to `main` with SQL + ledger entry.
2. Identify predecessor scripts; confirm staging already has them (query `information_schema` or use drift checklist).
3. Apply new script only in Supabase SQL Editor against **staging** (`sgcdncjxauhsbunobmob`).
4. Run validation:
   - `npm run smoke:db` (staging credentials)
   - Feature-specific tests
   - Signup smoke if trigger/functions changed
5. Update ledger: `staging_applied = YES`, date, verifier, commit SHA.
6. Document any staging-only fixes separately (e.g. grant gaps under test).

**Never** point staging validation at production credentials.

---

## Production application process

1. Complete staging validation and release gate (`docs/operations/RELEASE_GATE.md`).
2. Human explicitly approves production SQL execution.
3. Apply script in Supabase SQL Editor against **ALCR** only.
4. Verify:
   - Application health (`GET /healthz`)
   - Targeted smoke (call, desk save, wallet RPC if touched)
5. Update ledger: `production_applied = YES`, date, executor, commit SHA.
6. **Do not** replay full greenfield bootstrap on production.

---

## Verification process

| Stage | Minimum checks |
| --- | --- |
| After single script | SQL success; no dependency errors; spot-check affected objects |
| After feature merge | `npm run test:mvp` or feature tests; desk build if UI touched |
| After staging apply | `npm run smoke:db`; signup if auth path touched |
| Before production | Release gate checklist; schema drift review if large change |
| Periodic | Compare staging vs production catalogs (`SCHEMA_DRIFT_POLICY.md`) |

---

## Ledger update requirements

Every database change merged to `main` must add or update an entry in `docs/supabase/MIGRATION_LEDGER.md` with:

| Field | Required |
| --- | --- |
| What changed | Yes |
| Why (feature/ticket) | Yes |
| Where (file path) | Yes |
| Introducing commit | Yes (after merge) |
| Staging applied | YES / NO / UNKNOWN |
| Production applied | YES / NO / UNKNOWN |
| Verification performed | Yes |
| Applied date | Only if evidenced — else UNKNOWN |

Do not fabricate historical application dates.

---

## Dual-model coexistence (explicit)

| Question | Answer |
| --- | --- |
| Should we delete CLI migration history on production? | **No** |
| Should greenfield replay CLI migrations? | **No** — use manual path (proven 3E) |
| Should new work add CLI migrations? | **PROPOSED:** defer until Platform lane adopts `supabase/migrations/` with a cutover plan |
| Which is authoritative for intent? | Git `docs/supabase/*.sql` |
| Which is authoritative for reality? | Live database catalog |

---

## Infrastructure portability

SQL in `docs/supabase/` is Postgres-standard with Supabase Auth dependencies (`auth.users`, `auth.uid()`). To migrate off Supabase:

1. Foundation + feature scripts remain the schema source of truth.
2. Replace Auth trigger targets and JWT helpers (`current_user_tenant_ids`).
3. Replace Storage bucket creation with target object store.
4. Ledger and apply order documents preserve institutional knowledge.

---

## Related documents

- [`DATABASE_APPLY_ORDER.md`](./DATABASE_APPLY_ORDER.md) — exact apply sequence
- [`../supabase/README.md`](../supabase/README.md) — tier index
- [`../supabase/MIGRATION_LEDGER.md`](../supabase/MIGRATION_LEDGER.md) — change registry
- [`DATABASE_GOVERNANCE.md`](./DATABASE_GOVERNANCE.md) — lane ownership
- [`../operations/RELEASE_GATE.md`](../operations/RELEASE_GATE.md) — pre-production checklist
