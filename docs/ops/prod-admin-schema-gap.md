# Prod Admin schema gap ("Setup is incomplete")

**Status:** draft. Nothing has been applied. Prod SQL needs Alvin's OK.
**Compared:** 2026-10-09 10:30 EAT. Read-only `information_schema` SELECTs on prod `ALCR` (`fjxcdccgyhnvnnlnovcl`) and staging `scalers-staging` (`sgcdncjxauhsbunobmob`). Compared against main `87cd6f94`. Main moved to `db84f5ca` (#613) at 10:41 EAT.

## What prod shows

| Route | Prod today |
| --- | --- |
| `/admin` (Overview) | "Setup is incomplete" |
| `/admin/platform` | "Setup is incomplete" |
| `/admin/businesses`, `/billing`, `/numbers`, `/packages`, `/voices` | Load |

**Update 10:45 EAT:** after #613 deployed to prod (`db84f5ca`), Overview and Platform no longer show the error. #613 makes the missing ops tables degrade to "not persisted". The tables below are still missing, so ops settings and notices cannot be saved on prod until steps 1 and 2 are applied.

Before #613: Overview and Platform both call `evaluatePlatformOps()` (`dashboard/src/lib/platformOps.ts`). It reads `platform_ops_settings` and `platform_ops_notices`, and neither table exists on prod. Prod logs show `[admin:overview] [object Object]`. The Supabase error is a plain object, so `isMissingTable()` stringifies it to `[object Object]` and misses the "schema cache" text. The missing table rethrows and the page shows the setup error.

## Tables Admin reads (main)

`.from()` and `.rpc()` calls in `lib/admin*.ts`, `lib/platformOps.ts`, `lib/didPool.ts`, `lib/packageCatalog.ts`, `lib/sonioxVoiceCatalog.ts`, `lib/wallet*.ts`, `app/admin`, `app/api/admin` and `components/Admin*`:

| Table / RPC | Prod | Staging |
| --- | --- | --- |
| `tenants`, `calls`, `tenant_members`, `tenant_subscriptions`, `billing_packages`, `billing_rate_card`, `wallet_ledger`, `ops_audit_log`, `sautikit_did_pool`, `platform_soniox_voices` | present, same columns | present |
| RPCs `assign_did_from_pool`, `assign_specific_did_to_tenant`, `assign_tenant_package`, `grant_tenant_package_minutes`, `release_did_from_business`, `remove_business_and_release_did`, `set_tenant_billing_mode` | present | present |
| **`platform_ops_settings`** (emails, id, kinds, people, sautikit_warn_minor, updated_at) | **missing** | present |
| **`platform_ops_notices`** (id, kind, status, detail, opened_at, notified_at, acked_at, resolved_at) | **missing** | present |
| **`voice_turn_traces`** (id, call_id, tenant_id, turn_index, record_kind, schema_version, pii, payload, score, checks, diagnosis, release, created_at) | **missing** | present |

Main does not read `voice_turn_traces` from Admin yet. The Quality pages in #602/#603 read it, and so does the voice trace writer (`src/speech/voiceTrace.js`, behind `VOICE_TRACE`). Apply it before Quality ships to prod.

## Other prod vs staging drift (Admin does not read these)

| Item | Prod | Staging | Source |
| --- | --- | --- | --- |
| `calls.inbox_assignee_name`, `calls.inbox_assignee_phone` | missing | present | **No SQL file in the repo** (not in any git history). Staging-only manual change. Leave prod alone until a file exists. |
| fn `refresh_line_status(uuid)`, fn `suspend_line_for_nonpayment(uuid)` | missing | present | `docs/supabase/line_rental_grace.sql` sections 4 and 5. Prod already has the section 1 columns and `apply_line_rental`. **Do not re-run the whole file:** section 2 replaces `tenants_protect_wallet_columns()` with an older body than the one from `package_catalog.sql`. Only sections 4 and 5 would be needed. No app code calls these yet. |

## Apply order (draft, for Alvin's OK)

Each file is idempotent (`if not exists` / `on conflict do nothing`). The new tables are service-role only, with RLS on and no owner policies.

1. `docs/supabase/platform_ops_notices.sql` (README tier 24l). No dependencies beyond `gen_random_uuid()`. Creates `platform_ops_settings` (singleton row id=1) and `platform_ops_notices`. **This alone clears "Setup is incomplete" on Overview and Platform.**
2. `docs/supabase/platform_ops_people.sql` (24m). Depends on 1. Adds `platform_ops_settings.people` and backfills it from `emails`.
3. `docs/supabase/voice_turn_traces.sql` (24n). README lists it after 2, but it has no hard dependency. Creates `voice_turn_traces` with its indexes. Needed for the Quality pages (#602/#603), not for today's Admin.

Optional, separately: `line_rental_grace.sql` sections 4 and 5 only, if line suspension ships. `calls.inbox_assignee_*` needs a SQL file first.

Verify after applying (read-only):

```sql
select table_name from information_schema.tables
where table_schema = 'public'
  and table_name in ('platform_ops_settings', 'platform_ops_notices', 'voice_turn_traces');
select column_name from information_schema.columns
where table_schema = 'public' and table_name = 'platform_ops_settings';
```

## Code follow-up

Done in #613 (merged): `isMissingTableError()` and `adminErrorParts()` now read plain Supabase error objects.

## Decisions for Alvin

1. OK to apply steps 1 and 2 on prod? With #613 live, the page no longer breaks without them. Without them, though, prod cannot save ops-mail people or settings, and it keeps no open notices.
2. OK to apply step 3 now, or wait until Quality (#602/#603) is approved?
3. Should `calls.inbox_assignee_name` / `inbox_assignee_phone` on staging get a SQL file, or be dropped from staging?
