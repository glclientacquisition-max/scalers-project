# Billing schema baseline

`supabase/migrations/20261031020000_billing_schema_baseline.sql` holds the billing schema as it runs on production: 29 tables, 5 views, 134 functions, triggers (including the five billing triggers on `tenants`), RLS, policies, grants for `anon`, `authenticated`, `service_role` and `public`, and the two billing pg_cron jobs.

It is generated, not hand-written. Every statement is create-if-missing, create-or-replace or drop-then-create, so a database that already matches production does not change.

## Regenerate

1. Run `generate.sql` read-only on production (it is `objset.sql` + `gen.sql`). It only reads `pg_catalog`, `pg_policies` and `cron.job`.
2. Save the JSON result and run `python3 build.py <result-file>`. It writes `baseline.sql` (the migration) and `staging_dryrun.sql`.

## Check a database against production

`staging_dryrun.sql` opens a transaction, applies the baseline, fingerprints every object (md5 of its generated DDL) and raises `DIFF:<count> <list>` against the production fingerprints. The raise rolls everything back, so the target is never changed. `MISSING` means production has it and the target does not, `CHANGED` means it differs, `EXTRA` means only the target has it. The baseline never drops extras.

What is out of scope: non-billing columns on `tenants` and `calls`, and data. Extend the lists in `objset.sql` if a billing object is added.
