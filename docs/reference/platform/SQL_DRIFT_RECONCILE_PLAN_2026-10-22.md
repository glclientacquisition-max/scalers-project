---
owner: platform
last_reviewed: 2026-10-22
status: plan
---

> **Status: plan only, nothing applied. The reconcile (merges and migration-row inserts) awaits Alvin's yes in Platform's chat.**
>
> Since this was written (~08:55 EAT): #868's `call_messages` was applied on prod at 09:11 EAT (version `20261022061117`), so §1, §4a and the "#868 stays out" note are stale on that row. Main has since moved to `b40f567f` (#869, #870).
>
> Reference copy of the box brief `briefs/sql-drift-reconcile-plan-2026-10-22.md`. Paths under `/workspace/` are box paths and are not in the repo. See [STATUS.md](../../STATUS.md).

# SQL drift reconcile plan (draft, nothing applied)

Prepared 22 Oct 2026, ~08:55 EAT, by Platform, for Scalers Chief.

Sources, all read-only:
- `supabase_migrations.schema_migrations` on staging `sgcdncjxauhsbunobmob` and prod `fjxcdccgyhnvnnlnovcl`, compared by name, version and md5 of `statements`.
- PR heads fetched into `/workspace/wt-status-md`.
- `main` at `2f168419`.

No DB writes, merges, labels or Railway changes were made.

## TL;DR

- **Repo `supabase/migrations` filenames don't match DB `version`s almost anywhere.** `apply_migration` stamps the apply time, so this is structural, not a bug. Treat **name + statement bytes** as the identity, and accept that versions differ per DB.
- **One real repo defect:** the version `20261022013000` is used twice, by #865 (`revoke_anon_default_privileges`) and #866 (`inbox_unarchive_calls`). Also, #864 and #865 add the same `tests/revokeOpenTableGrants.test.js`, so whichever merges second conflicts.
- **Content check:** what's live on prod is byte-identical to the PR file for every drifted PR, with two exceptions:
  - #864's `supabase/migrations` copy has one extra comment line.
  - #865's DB row stores only the 3 statements, with no comments. The executable SQL is the same.
- **Missing rows:**
  - prod `inbox_archive_cascade` (#862, merged)
  - both DBs `tenants_unknown_answer_grant` (#852). The grant itself is live on both.
- **Watch paths already exist** on prod Voice (see `voice-watch-paths-plan-2026-10-22.md`), so they don't need to "land first". What matters is keeping SQL-only PRs free of `package.json`, `src/**` and `server.js`, so merging them doesn't rebuild or restart prod Voice.
- **Recommended merge order:** #852 → #864 → #865 (after fix) → #866 (after fix, minus package.json) → split SQL-only PRs for #859, #844 and #845. #868 is staging-only, so it waits. Then record the missing rows with direct `INSERT`.

## 1. What each PR carries besides SQL

Watched paths are `/server.js`, `/db.js`, `/src/**`, `/package*.json`, `/Dockerfile`, `/.dockerignore` and `/railway.toml`.

| PR | Head | SQL | Live where | Other content | Watched? | Merge as-is? |
| --- | --- | --- | --- | --- | --- | --- |
| #844 | `d4609435` (13 behind main) | `docs/supabase/greeting_language.sql` (no migrations file) | prod as `greeting_language`, staging as `greeting_language_last_line_cut`, same bytes (7784 B). Staging also has an older `greeting_language` (7437 B). | `src/db.js` +433, `src/conversation/contactIdentity.js`, `src/tenantProfile.js`, `package.json`, tests. In combined build `f07f9c8a` and the Brain stack. | **yes** | **No.** Split the SQL out. |
| #845 | `f70d855e` | `docs/supabase/brain_write_receipts.sql` (no migrations file) | both, identical | `src/db.js` +170 (`recordWriteReceipt`), `package.json`, tests. Merged into #849 (Brain stack). | **yes** | **No.** Split the SQL out. |
| #852 | `f310bf4f` | `docs/supabase/tenants_unknown_answer_grant.sql` (1 grant) and README | grant live on both, **no row on either** | none | no | **Yes** |
| #859 | `b530a10a` (draft) | `supabase/migrations/20261021220000_merge_call_summary.sql`, plus a comment-only edit to `docs/supabase/lead_status.sql` | both, identical | `server.js`, `src/db.js` +631, `src/speech/*`, scripts, `.env.example`, `package.json`, tests | **yes** | **No.** Split the SQL out. |
| #864 | `0e0b7fa4` | `supabase/migrations/20261022010000_revoke_open_table_grants.sql` and `docs/supabase/revoke_open_table_grants.sql` | both. DB bytes equal the **docs** file (md5 `06344c8a…`, 4433 B). The migrations copy adds a first line, "-- Migration copy of … (keep in sync)", 4513 B. | `tests/revokeOpenTableGrants.test.js` (not wired into `package.json`, so CI never runs it) | no | **Yes** (the extra comment line is harmless) |
| #865 | `593bc07c` | `supabase/migrations/20261022013000_revoke_anon_default_privileges.sql` and its docs copy | both. The row holds the 3 `alter default privileges … revoke all on tables/sequences/functions from anon` statements (290 chars). The file has the same 3 statements plus comments. | `tests/revokeOpenTableGrants.test.js` (the **same path as #864**) | no | **After a fix:** merge `main` in once #864 lands and resolve the test-file conflict. Keeps the version. |
| #866 | `ab0f602e` | `supabase/migrations/20261022013000_inbox_unarchive_calls.sql` (**duplicate version**) and `20261022013500_calls_record_caller_reply.sql`, plus docs | both, identical | **`package.json`** (`test:mvp` line), tests | **yes** (`package.json`) | **After a fix:** rename to `20261022013100_inbox_unarchive_calls.sql` (unused), and move the `package.json` line to a later Voice PR or accept a prod Voice restart. |
| #868 | `f6760559` | `supabase/migrations/20261022080000_call_messages.sql` and docs | **staging only** (`20261022052211`) | `package.json`, tests | yes | Not in this reconcile. It needs a prod apply decision first. |
| #862 | merged `7c2e1ae0` | `supabase/migrations/20261022004500_inbox_archive_cascade.sql` and docs | staging row `20261021214659`. **Prod: applied (per Scalers Chief 00:55 EAT, unverified by object check here) but no row.** | none | no | already merged |

## 2. Order and method

Rule for this batch: no merge touches a watched path, so prod Voice stays on `3bb1d0e3` and no live calls are dropped. Every merge to `main` needs Alvin's explicit yes in Platform's chat.

1. **#852: merge as-is.** Docs only. Expect prod Voice SKIPPED.
2. **#864: merge as-is.** Optionally drop the extra comment line so the migrations file equals the DB bytes. Not required, because the content is equivalent.
3. **#865:** merge `main` in and resolve `tests/revokeOpenTableGrants.test.js`. Keep #864's version and fold in #865's extra cases. Then merge. Keep version `20261022013000`; it has no other duplicate after step 4.
4. **#866:** commit a rename of `inbox_unarchive_calls` to `20261022013100` and update the references in docs and the README. Revert the `package.json` hunk (park it for the next Voice PR), then merge. No force-push; these are new commits on the branch.
   - If the team would rather keep the `package.json` line: the merge rebuilds prod Voice with no runtime change, which is still a restart. Do the live-call check first.
5. **New SQL-only PR for #859:** add `supabase/migrations/20261021220000_merge_call_summary.sql` and the `lead_status.sql` comment edit, branched off `main`. #859 keeps the code. Once the split merges, merge `main` into #859; the SQL file then shows no diff.
6. **New SQL-only PR for #844 + #845:** add `docs/supabase/greeting_language.sql` and `docs/supabase/brain_write_receipts.sql`, plus their README and `MIGRATION_LEDGER.md` lines, off `main`.
   - Optionally add `supabase/migrations/*` copies with unique versions.
   - #844 and #845 keep their code for the combined-build and Brain review. Merge `main` into each afterwards.
7. **Record the missing rows** (§3). Staging first. Prod needs Alvin's yes.
8. **Ledger:** update `docs/supabase/MIGRATION_LEDGER.md` with a name → (repo file, staging version, prod version) table taken from §4. After that, drift is a lookup rather than a surprise.

#868 stays out until prod `call_messages` is decided. The same goes for any staging-only names (§4c).

## 3. Recording the missing rows: INSERT, not `supabase migration repair`

**Recommendation: a direct `INSERT` into `supabase_migrations.schema_migrations`.** Run it through the Supabase connector `execute_sql`, on staging first, then on prod with Alvin's yes.

Why not `migration repair`:
- The repo has **no `supabase/config.toml`** and no CLI link to either project.
- `repair` needs `supabase link` and the DB password on the box.
- It records the **repo filename version**, which wouldn't match how every other row on these DBs was recorded (apply time via `apply_migration`).
- It doesn't fill `statements`, so the rows would be less useful for drift checks.

Why not re-run `apply_migration`: it would re-execute DDL on prod to get a row. It's idempotent, but that's still a real change with locks and grants. An insert records history without touching objects.

Before inserting, verify the objects exist with a read-only check:
- #862: `\d calls` columns, functions and indexes from `inbox_archive_cascade.sql`.
- #852: `has_column_privilege('authenticated','public.tenants','unknown_answer_spoken','UPDATE')`. Both DBs were already verified for this.

Draft SQL (not run; `<file>` means the exact file bytes as one array element, the same way the other rows store them):

```sql
-- prod only: #862
insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261021215500', 'inbox_archive_cascade', array[$sql$<supabase/migrations/20261022004500_inbox_archive_cascade.sql>$sql$])
on conflict (version) do nothing;

-- staging and prod: #852
insert into supabase_migrations.schema_migrations (version, name, statements)
values ('<apply time UTC, YYYYMMDDHHMMSS>', 'tenants_unknown_answer_grant',
        array['grant update (unknown_answer_spoken, unknown_answer_by_kind) on public.tenants to authenticated;'])
on conflict (version) do nothing;
```

- Version `20261021215500` is 00:55 EAT 22 Oct in UTC, per Scalers Chief's apply time (*approximate, unverified to the second*).
- #852's exact apply time is unknown. Use the time the grant was first applied if Voice or Chief has it. Otherwise use the insert time, and say so in the ledger.
- `created_by` and `idempotency_key` stay null. Check that no existing row already uses the chosen version, then check `select count(*) where name = …` afterwards.

## 4. Every repo-vs-DB mismatch found

### 4a. Repo `supabase/migrations` files vs recorded versions (by name)

| Name | Repo file version | Staging | Prod |
| --- | --- | --- | --- |
| price_unit_preserve | 20261018200000 | 20261018200000 ✓ | 20261018200000 ✓ (**the only match**) |
| calls_tenant_created_idx | file on main | **no row** | 20261012093250 |
| revoke_anon_create_tenant_invite / revoke_anon_accept_transfer | files on main | rows (versions differ from files) | **no rows by these names.** Prod has a combined `revoke_anon_invite_functions` `20261018180859`. |
| merge_call_summary (#859) | 20261021220000 | 20261021194944 | 20261021220958 |
| inbox_archive_cascade (#862) | 20261022004500 | 20261021214659 | **no row** |
| revoke_open_table_grants (#864) | 20261022010000 | 20261021221832 | 20261021222022 |
| revoke_anon_default_privileges (#865) | **20261022013000** | 20261021223115 | 20261021223146 |
| inbox_unarchive_calls (#866) | **20261022013000 (duplicate)** | 20261021223101 | 20261022043251 |
| calls_record_caller_reply (#866) | 20261022013500 | 20261021223103 | 20261022043258 |
| call_messages (#868) | 20261022080000 | 20261022052211 | **no row (not applied)** |
| older files on main (team_invites … unknown_answer_spoken) | file timestamps | all differ by timestamp | all differ by timestamp |

### 4b. DB rows with no `supabase/migrations` file (docs/supabase only, or nothing)
- `greeting_language` (both). Staging also has `greeting_language_last_line_cut`, which matches prod's bytes.
- `brain_write_receipts` (both)
- `contacts_owner_insert`: staging `20260909190154`, prod `20261021222808`. Prod statement: drop/create policy `contacts_insert_member` for insert to authenticated with check `tenant_id in current_user_tenant_ids()`, plus `grant insert on contacts to authenticated`. Source: `docs/supabase/contacts_owner_insert.sql` on main.
- Many `billing_*` rows (docs/supabase scripts)
- `tenants_unknown_answer_grant`: **no row anywhere**, though the grant is live (#852)

### 4c. Content mismatches
- #864: the migrations file is the docs file plus one comment line. DB = docs file.
- #865: DB = the 3 statements without comments. File = the same statements plus comments. **Semantically equal (likely)**; compared by stripping comments.
- Staging `greeting_language` (7437 B) is an older body, superseded by `greeting_language_last_line_cut`.
- Everything else compared (merge_call_summary, inbox_unarchive_calls, calls_record_caller_reply, brain_write_receipts, inbox_archive_cascade on staging, call_messages on staging) is **byte-identical** to the PR file.

### 4d. Out of scope but noted
- PUBLIC can still execute 101 public functions on staging (15 SECURITY DEFINER) and 103 (15) on prod. #865 handles future defaults only.
- No `admin_auth` schema on either DB.

## 5. Watch paths: should they land first?

No, because they already exist and #862 proved a skip. The rule for this batch is still to keep watched paths out of SQL PRs (#866's `package.json` line). Railway builds look paused (the exact state is *unverified*), so a watched merge might not deploy right now. It would still mean a prod restart later. Note that `main` already has 6 un-built `package.json`-only merges, so the next prod Voice build will happen regardless. It's test scripts only.

## 6. Approvals needed (none requested yet)

- Merges to `main` (#852, #864, #865, #866, and the two split PRs): Alvin's yes in Platform's chat.
- Branch commits on #865 and #866: these are Platform's own drafts, so Platform makes the fixes as normal commits (no force-push).
- Prod `INSERT`s: Alvin's yes. Staging inserts are Platform-owned but still not run in this task.
