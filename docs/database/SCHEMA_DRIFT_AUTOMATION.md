# Schema drift automation

**Status:** Implemented Phase 3G (2026-08-15)  
**Scope:** Git manifest vs **staging only** — never production

---

## Components

| Artifact | Role |
| --- | --- |
| `docs/database/staging_schema_manifest.json` | Expected staging catalog subset |
| `scripts/verify-staging-schema.js` | Read-only verification script |
| `npm run verify:staging-schema` | Lightweight mode (Supabase API) |
| `npm run verify:staging-schema:catalog` | Full mode (postgres catalog + `pg`) |
| `.github/workflows/staging-validate.yml` | Post-merge automation |

---

## What is checked

### Lightweight mode (default)

No `STAGING_DATABASE_URL` required. Uses `SUPABASE_URL` + service_role.

| Check | Method |
| --- | --- |
| Public tables exist | `HEAD` select on each table in manifest |
| Key tenant columns | Select `required_tenant_columns` |
| Storage buckets | `storage.listBuckets()` |
| Production block | Refuses `fjxcdccgyhnvnnlnovcl` in URL |

### Catalog mode (`--catalog`)

Requires `STAGING_DATABASE_URL` (postgres connection string).

| Check | SQL source |
| --- | --- |
| Foundation column counts | `information_schema.columns` |
| RLS enabled flags | `pg_class.relrowsecurity` |
| Policy count | `pg_policies` |
| Extensions | `pg_extension` |
| Required functions | `pg_proc` signatures |
| Staging-only grant note | `has_column_privilege` (informational) |

---

## What is NOT checked (Phase 3G)

| Item | Reason |
| --- | --- |
| Full column type/nullability per table | Deferred — update manifest + catalog mode incrementally |
| Index definitions | Deferred |
| Policy expression text diff | Deferred |
| Trigger bodies | Deferred |
| Production comparison | **Forbidden** in automation (Rule 0) |
| Application row data | **Never** |

---

## Updating the manifest

When a feature adds tables/columns/functions:

1. Merge SQL + apply to staging.
2. Update `staging_schema_manifest.json`.
3. Re-run `npm run verify:staging-schema:catalog` locally.
4. Commit manifest with the feature PR.

---

## CI integration

`staging-validate.yml` runs on push to `main` when secrets configured:

1. `smoke:db`
2. `verify:staging-schema`
3. `verify:staging-schema:catalog` (if `STAGING_DATABASE_URL` set)

PR CI (`ci.yml`) does **not** require staging secrets.

---

## Failure triage

| Failure | Likely class | Action |
| --- | --- | --- |
| Missing table | D3 staging lag | Apply SQL to staging |
| Wrong column count | D3 or manifest stale | Reconcile apply order / update manifest |
| Missing function | D3 | Apply wallet/DID chain scripts |
| Staging grant warning | D0 expected | Documented staging-only fix |

---

## Related documents

- [`SCHEMA_DRIFT_POLICY.md`](./SCHEMA_DRIFT_POLICY.md)
- [`staging_schema_manifest.json`](./staging_schema_manifest.json)
- [`../operations/STAGING_VALIDATION.md`](../operations/STAGING_VALIDATION.md)
