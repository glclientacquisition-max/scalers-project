# Schema drift policy

**Status:** Canonical policy (Phase 3F, 2026-08-15)  
**Goal:** Detect **STAGING ≠ PRODUCTION** schema divergence without reading application data.

---

## Scope

Compare **catalog metadata only**:

| Object class | Included |
| --- | --- |
| Tables | Yes |
| Columns (name, type, nullability, default) | Yes |
| Constraints (PK, FK, UNIQUE, CHECK) | Yes |
| Indexes | Yes |
| RLS enabled flag | Yes |
| Policies (name, command, roles, qual/with_check) | Yes |
| Table/column grants | Yes |
| Functions (name, args, security definer) | Yes |
| Triggers | Yes |
| Extensions | Yes |
| Storage buckets (metadata) | Yes |
| Storage policies | Yes |
| Row data | **NO** |
| Auth user records | **NO** |

---

## Drift classes

| Class | Definition | Response |
| --- | --- | --- |
| **D0 — Expected** | Documented gap (e.g. staging notify_channels grant test fix) | Document in ledger; do not auto-sync |
| **D1 — Git lag** | Production has change not in Git | **P0** — recover SQL into repo before next feature |
| **D2 — Apply lag** | Git has change not on production | **P1** — schedule production apply via release gate |
| **D3 — Staging lag** | Git has change not on staging | **P1** — apply to staging before merge validation |
| **D4 — Environment noise** | Test data, seeds, non-schema config | Ignore for schema compare |

---

## Comparison method (manual baseline)

### Step 1 — Export catalogs

Run against each project (SQL Editor or `psql`). **Read-only queries only.**

```sql
-- Tables and columns
select table_schema, table_name, column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema in ('public', 'storage')
order by 1, 2, ordinal_position;

-- RLS policies
select schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
from pg_policies
where schemaname in ('public', 'storage')
order by 1, 2, 3;

-- Functions (public API)
select p.proname, pg_get_function_identity_arguments(p.oid) as args,
       p.prosecdef as security_definer
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
order by 1, 2;

-- Extensions
select extname, extversion from pg_extension order by 1;
```

Save outputs as `staging_catalog_<date>.txt` and `production_catalog_<date>.txt`. **Do not commit credentials or outputs containing secrets.**

### Step 2 — Diff

Use `diff -u` on sorted exports or a dedicated schema diff tool.

### Step 3 — Triage

Map each difference to:

- Ledger entry (known change)
- D0 documented gap
- Unexpected drift → ticket

---

## Known expected differences (D0)

| Item | Staging | Production | Notes |
| --- | --- | --- | --- |
| `notify_channels` UPDATE grant | Present (Phase 3E test fix) | Absent | LEDGER-STAGING-NOTIFY-GRANT |
| Data rows | Smoke/test only | Live | D4 — ignore |
| CLI `schema_migrations` rows | Not replayed | 24 rows | D4 — history table, not app schema |
| Available DID pool rows | May differ | Production inventory | D4 — seed data |

---

## Automation (Phase 3G)

Implemented: [`SCHEMA_DRIFT_AUTOMATION.md`](./SCHEMA_DRIFT_AUTOMATION.md)

- `npm run verify:staging-schema` — staging vs manifest (read-only)
- Post-merge: `.github/workflows/staging-validate.yml`

**PROPOSED (not deployed):** production comparison requires read-only audit role.

---

1. Connect to **staging** with read-only credentials (service_role acceptable for catalog queries; no data SELECT).
2. Connect to **production** only if explicit read-only audit role exists — **currently NOT configured**.
3. Export catalogs to artifacts.
4. Fail on unexpected `public` table/column/policy diff.
5. Post summary to PR or Slack.

### Why not deployed in Phase 3F

| Risk | Mitigation needed |
| --- | --- |
| Production credentials in CI | Dedicated read-only DB role |
| False positives from D0 gaps | Baseline allowlist file |
| Accidental write | Read-only connection string + query allowlist |
| Agent auto-remediation | **Forbidden** — human triage only |

**Recommendation:** Implement automation after:

1. Production read-only audit role created (Platform).
2. D0 allowlist committed to `docs/database/drift_allowlist.json`.
3. Staging-only CI diff first (Git expected schema vs staging).

---

## Staging-only CI diff (safer first step)

**PROPOSED Phase 3G:**

```
Git intent (script parse or manifest)
        vs
Staging catalog (post-apply)
```

Validates reproducibility without production access. Aligns with Phase 3E proof.

---

## Frequency

| Environment pair | Frequency |
| --- | --- |
| Git vs staging | After every SQL merge + weekly |
| Staging vs production | Before every production SQL release |
| Git vs production | Quarterly audit (read-only, human-approved) |

---

## Escalation

| Drift severity | Owner | Action |
| --- | --- | --- |
| Missing RLS policy on production | Platform + Security | P0 hotfix |
| Extra column on production not in Git | Platform | Recover SQL into repo |
| Missing column on production vs Git | Ops + Platform | Schedule apply via release gate |
| Grant mismatch affecting desk | Desk + Platform | Grant repair script + ledger |

---

## Related documents

- [`MIGRATION_LEDGER.md`](../supabase/MIGRATION_LEDGER.md)
- [`DATABASE_APPLY_ORDER.md`](./DATABASE_APPLY_ORDER.md)
- [`ENVIRONMENT_CONTRACT.md`](../operations/ENVIRONMENT_CONTRACT.md)
- [`../security/PHASE_3F_SECURITY_REVIEW.md`](../security/PHASE_3F_SECURITY_REVIEW.md)
