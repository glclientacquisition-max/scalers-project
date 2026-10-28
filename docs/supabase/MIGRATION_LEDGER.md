---
owner: platform
last_reviewed: 2026-10-28
---

# Migration ledger

**Status:** Authoritative index (hardened Phase 3F, 2026-08-15)  
**Production:** ALCR (`fjxcdccgyhnvnnlnovcl`)  
**Staging:** `scalers-staging` (`sgcdncjxauhsbunobmob`)

Scalers uses a **dual migration model**:

1. **Foundation tables** — predate documented migration system; bootstrap via [`foundation_bootstrap.sql`](./foundation_bootstrap.sql) (production-introspected, historically unverified).
2. **Manual SQL scripts** — `docs/supabase/*.sql` applied via SQL Editor (primary governance model).
3. **Supabase CLI migrations** — partial adoption from 2026-08-07; recorded in `supabase_migrations.schema_migrations` on production (25 rows).

---

## Foundation tables

| Table | Columns | Bootstrap source | Historical CREATE provenance |
| --- | --- | --- | --- |
| `public.tenants` | 49 | `foundation_bootstrap.sql` | **UNKNOWN** |
| `public.calls` | 21 | `foundation_bootstrap.sql` | **UNKNOWN** |
| `public.transcripts` | 6 | `foundation_bootstrap.sql` | **UNKNOWN** |

**Do not use** commit `9153a09` CREATE TABLE as foundation source.

---

## Production CLI migration ledger (`supabase_migrations.schema_migrations`)

Recorded on ALCR as of 2026-08-14 (24 rows). None create foundation tables.

| Version | Name | Touches foundation |
| --- | --- | --- |
| 20260807225947 | daily_bulletin | tenants.daily_bulletin |
| 20260808005039 | escalation_enabled | tenants.escalation_enabled |
| 20260808053931 | alert_email | tenants.alert_email |
| 20260808080322 | one_wallet_billing | tenants wallet columns |
| 20260808103634 | wallet_security_beta_part1 | tenants beta + trigger |
| 20260808103644 | wallet_security_beta_part2_rpcs | RPCs (touch tenants) |
| 20260808103657 | wallet_security_beta_part3_grants | tenants/calls grants |
| 20260808112824 | agent_tools | tenants.agent_tools |
| 20260811044451 | business_operating_model | tenants vertical/handoff/locations/policies |
| 20260811044502 | contacts_and_requests | FK to calls, tenants |
| 20260811061942 | fix_charge_call_wallet_ambiguous | RPC |
| 20260811072236 | lead_status_archive | calls.lead_status CHECK |
| 20260811072353 | wallet_soft_spend_limit | tenants soft spend |
| 20260811073319 | wallet_on_demand_alerts | tenants on-demand columns |
| 20260811073341 | wallet_on_demand_alerts_fns | RPC + trigger patch |
| 20260811073356 | wallet_claim_alerts_and_ondemand_rpc | RPC |
| 20260811102735 | add_tenants_tts_lexicon | tenants.tts_lexicon |
| 20260811122648 | grant_owner_update_tts_lexicon | grant |
| 20260811142321 | product_catalog_and_social | tenants product/social |
| 20260812025507 | call_resolution | calls resolution columns |
| 20260812083631 | appointments | FK to calls, tenants |
| 20260812141513 | soniox_voice_catalog | tenants voice columns |
| 20260813073840 | pronunciation_gemini_scan | tenants pronunciation columns |
| 20260813210755 | notify_channels | tenants.notify_channels |

**Not in CLI ledger (applied manually):**

- `multi_tenant_onboarding.sql`, `owner_rls.sql`, tier 2–7 manual scripts predating CLI adoption
- `fix_p0_rls_remove_legacy_allow_all.sql` (P0, 2026-08-14)

---

## Manual script tiers (summary)

Full order: [`README.md`](./README.md).

| Tier | Scope | Foundation dependency |
| --- | --- | --- |
| 0 | `foundation_bootstrap.sql` | Creates tenants, calls, transcripts |
| 1 | Membership + RLS | Requires tenants |
| 2–4 | Tenant profile columns | `ALTER TABLE tenants ADD COLUMN` (no-op if bootstrapped) |
| 5 | Owner CRM | `ALTER TABLE calls ADD COLUMN` |
| 6–9 | DID, wallet, BI, appointments | FK references to tenants/calls |

---

## Column lineage — foundation-era columns

Columns present before CLI migration adoption. Earliest Git evidence is comment-only introspection (`34d0d54`, Aug 6 2026), not CREATE TABLE.

### tenants (foundation-era)

| Column | Production type | Earliest Git evidence | Evidence type |
| --- | --- | --- | --- |
| id | uuid | `34d0d54` schema.sql comment | FOUNDATION_UNKNOWN |
| created_at | timestamptz | `34d0d54` | FOUNDATION_UNKNOWN |
| business_name | text | `34d0d54` | FOUNDATION_UNKNOWN |
| sautikit_virtual_number | text | `34d0d54` | FOUNDATION_UNKNOWN |
| whatsapp_notification_number | text | `34d0d54` | FOUNDATION_UNKNOWN |
| llm_system_prompt | text | `34d0d54` | FOUNDATION_UNKNOWN |
| is_active | boolean | `34d0d54` | FOUNDATION_UNKNOWN |

### calls (foundation-era)

| Column | Production type | Earliest Git evidence | Evidence type |
| --- | --- | --- | --- |
| id | uuid | `34d0d54` | FOUNDATION_UNKNOWN |
| created_at | timestamptz | `34d0d54` | FOUNDATION_UNKNOWN |
| tenant_id | uuid FK CASCADE | `34d0d54` | FOUNDATION_UNKNOWN |
| caller_number | text | `34d0d54` | FOUNDATION_UNKNOWN |
| sautikit_call_sid | text UNIQUE | `34d0d54` | FOUNDATION_UNKNOWN |
| status | text | `34d0d54` | FOUNDATION_UNKNOWN |
| duration_seconds | integer | `34d0d54` | FOUNDATION_UNKNOWN |
| recording_url | text | `34d0d54` | FOUNDATION_UNKNOWN |
| sentiment | text | `34d0d54` | FOUNDATION_UNKNOWN |
| summary | text | `34d0d54` | FOUNDATION_UNKNOWN |

### transcripts (all foundation-era)

| Column | Production type | Earliest Git evidence | Evidence type |
| --- | --- | --- | --- |
| id | uuid | `34d0d54` (utterance model) | FOUNDATION_UNKNOWN |
| created_at | timestamptz | `34d0d54` | FOUNDATION_UNKNOWN |
| call_id | uuid FK CASCADE | `34d0d54` | FOUNDATION_UNKNOWN |
| speaker | text | `34d0d54` | FOUNDATION_UNKNOWN |
| text_content | text | `34d0d54` | FOUNDATION_UNKNOWN |
| latency_ms | integer | `34d0d54` | FOUNDATION_UNKNOWN |

Additive columns (post-foundation) are documented per file in [`README.md`](./README.md) and mapped in Phase 3D-4 audit.

---

## Storage

| Bucket | Public | Created (production) | Git SQL |
| --- | --- | --- | --- |
| `call-recordings` | false | 2026-08-06 08:42 UTC | **UNKNOWN** (manual/Dashboard) |

Referenced in `foundation_bootstrap.provenance.md`, `schema.sql`, `DEPLOYMENT.md`.

---

## Security repairs

| File | Applied production | In CLI ledger |
| --- | --- | --- |
| `fix_p0_rls_remove_legacy_allow_all.sql` | YES (2026-08-14) | NO |

Post-P0 member-only RLS is encoded in `foundation_bootstrap.sql`.

---

## Ledger entry template (required for new changes)

Every database change merged to `main` must add a row to the **Change registry** below (or update an existing row). Use **UNKNOWN** when evidence does not exist. Do not fabricate dates.

| Field | Description |
| --- | --- |
| **ID** | `LEDGER-YYYY-MM-DD-<slug>` or script filename |
| **What** | Tables, columns, RPCs, policies, grants affected |
| **Why** | Feature, bugfix, or security repair |
| **Where** | Path under `docs/supabase/` |
| **Introduced commit** | Git SHA on `main` (after merge) |
| **Staging applied** | `YES` / `NO` / `UNKNOWN` |
| **Staging applied date** | ISO date if evidenced; else `UNKNOWN` |
| **Production applied** | `YES` / `NO` / `UNKNOWN` |
| **Production applied date** | ISO date if evidenced; else `UNKNOWN` |
| **In CLI ledger** | `YES` (version) / `NO` / `N/A` |
| **Verification** | Tests, smoke, manual checks performed |

### Process

1. Author SQL in `docs/supabase/<name>.sql` with `-- Run after:` header.
2. Update [`README.md`](./README.md) and [`DATABASE_APPLY_ORDER.md`](../how-to/DATABASE_APPLY_ORDER.md) if order changes.
3. Add ledger row before or with merge PR.
4. After staging apply: set `staging_applied = YES`, date, verification notes.
5. After production apply (human-approved): set `production_applied = YES`, date, executor.

---

## Change registry

### Foundation and governance

| ID | What | Why | Where | Introduced commit | Staging | Production | CLI | Verification |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| LEDGER-FOUNDATION | Bootstrap `tenants`/`calls`/`transcripts` shape | Phase 3D-5 reproducibility | `foundation_bootstrap.sql` | `c0985f0` | YES (2026-08-15 full rebuild) | N/A (already exists) | N/A | Staging column counts; RLS policy count |
| LEDGER-P0-RLS | Drop legacy allow-all RLS policies | P0 tenant isolation | `fix_p0_rls_remove_legacy_allow_all.sql` | `92af666` (#154) | YES (2026-08-15) | YES (2026-08-14) | NO | Production manual apply; staging greenfield no-op |

### Feature scripts (manual path)

| ID | What | Why | Where | Introduced commit | Staging | Production | CLI | Verification |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| LEDGER-NOTIFY-CH | `tenants.notify_channels` jsonb | Owner notify prefs | `notify_channels.sql` | `7af0fcb` (#155) | YES (2026-08-15) | YES (inferred pre-3E) | `20260813210755` | Staging rebuild; production CLI row |
| LEDGER-PROD-NOTIFY-GRANT | `GRANT UPDATE (notify_channels)` | Desk owner notify persistence | `notify_channels.sql` + `production_pending/grant_notify_channels_update.sql` | Phase 3H A3 | YES (2026-08-15) | YES (2026-08-16) | `20260816180900` | `has_column_privilege` true; wallet UPDATE still false |
| LEDGER-APPOINTMENTS | `appointments` table + RLS | Home-services bookings | `appointments.sql` | `7af0fcb` (#155) | YES (2026-08-15) | YES (inferred pre-3E) | `20260812083631` | Staging insert smoke |
| LEDGER-GREETING-IDENTITY | `tenants.spoken_name`, `tenants.greeting_invite` | Owner sets what callers hear for the shop, and one short invite. Empty keeps today's line. | `greeting_spoken_name.sql` | this PR | NO | NO | NO | Not applied. Voice engine falls back if the columns are missing. |
| LEDGER-GREETING-LANGUAGE | `tenants.greeting_text`, `greeting_language`; `contacts.last_language`, `last_language_at`, `name_confirmed`, `name_confirmed_at`, `name_confirmed_source`, `name_confirmed_call_id` + reset trigger; `calls.greeted_at`, `last_agent_line`, `last_line_cut`, `notice_given`, `stream_seq`, `last_stream_at` + `bump_call_stream_seq` | Greeting module (plan B3, Voice #843): owner greeting, languages, confirmed caller name, cross-replica opening resume | `greeting_language.sql` | this PR | NO | NO | NO | Not applied. db.js reads fall back and writers return ok:false if the columns are missing. |
| LEDGER-CONTACTS-INSERT | Owner INSERT on `contacts` | Desk add + CSV import | `contacts_owner_insert.sql` | this PR | YES (2026-09-09) | NO | NO | Policy `contacts_insert_member` |
| LEDGER-HOLD-WINDOWS | `service_requests.window_start` / `window_end` + When grant | Desk When+Save dual write | `service_request_windows.sql` | this PR | NO | NO | NO | Not applied yet. Desk falls back to `when_text` if columns missing. |
| LEDGER-REALTIME-INBOX | `supabase_realtime` publication += `calls`, `service_requests`, `appointments` | Live Inbox desk updates | `realtime_inbox.sql` | `bb6bb6c` (#279) | YES (2026-09-16) | YES (2026-09-16) | NO | Staging INSERT+UPDATE probe; production `pg_publication_tables` lists `appointments`, `calls`, `service_requests` |
| LEDGER-REALTIME-DESK | `supabase_realtime` publication += `tenants`, `wallet_ledger`, `transcripts` | Landed credit, minute change, and a new transcript line reach the owner desk | `realtime_inbox.sql` | this PR | NO | NO | NO | Apply by hand. Deploy does not run it. Member SELECT already exists. |
| LEDGER-REALTIME-INBOX-REPLICA | `REPLICA IDENTITY FULL` on `calls`, `service_requests`, `appointments` | Filtered hangup UPDATEs reach Live Inbox | `realtime_inbox_replica_identity.sql` | this PR | YES (2026-09-16) | YES (2026-09-16) | NO | `pg_class.relreplident = 'f'` on the three tables |
| LEDGER-NOTIFY-SENDS | Append-only `notify_sends` | Meter staff/caller SMS vs platform wallet/outage | `notify_send_ledger.sql` | `821980a` (#296) | YES (2026-09-17) | NO | NO | Table + RLS; `to_regclass` = `notify_sends` |
| LEDGER-BRAIN-WRITE-RECEIPTS | `brain_write_receipts` table + RLS | Typed receipt per Brain write attempt (v1/v2): proves whether a v2 write ever landed | `brain_write_receipts.sql` | this PR | NO | NO | NO | Not applied. `recordWriteReceipt` never throws; returns ok:false if the table is missing. |
| LEDGER-SMS-ALLOWANCE | Included SMS + on-demand stop | Cursor-like cap. Same Wallet toggle as minutes. | `sms_allowance.sql` | `821980a` (#296) | YES (2026-09-17) | Function already on production before 2026-09-30. Replaced that day by `package_minute_consume.sql`. | NO | `consume_sms_units` returns `beta` on staging (all tenants `billing_enforcement=off`) |
| LEDGER-PACKAGE-ENTS | Email + seat included columns | Later packages write these. No gate yet. | `package_entitlements.sql` | `821980a` (#296) | YES (2026-09-17) | NO | NO | Defaults 100 email / 5 seats; no gate |
| LEDGER-WHATSAPP-THREADS | `whatsapp_threads` + `whatsapp_messages` | Platform two-way WhatsApp persist | `whatsapp_threads.sql` | this PR | YES (2026-09-17) | NO | NO | Service role only. Staging apply `whatsapp_threads`. |
| LEDGER-LINE-RENTAL-GRACE | Line paid-through + grace | Prerequisite for SMS protect trigger | `line_rental_grace.sql` | prior | YES (2026-09-17) | NO | NO | Staging catch-up; `apply_line_rental` dropped/recreated for new OUT `line_paid_through` |
| LEDGER-PACKAGE-MINUTE-CONSUME | `calls.package_seconds_applied`, `consume_call_seconds`, `sms_charge` kind, replaced `consume_sms_units` | Meter package minutes. On-demand off does not debit. Next inbound is rejected in the voice webhook once included minutes are used. | `package_minute_consume.sql` | this PR | YES (2026-09-30) | YES (2026-09-30) | NO | Staging and production `proname = consume_call_seconds`. Production tenants: only Scalers Business Solutions has `minutes_included` 300 and `seconds_used` 0. Others have `minutes_included` 0, so inbound stays open. No call was metered by the apply. |
| LEDGER-RATE-CARD-6-9 | `billing_rate_card` inbound 0.10/sec, outbound 0.15/sec | On-demand calls KES 6/min. Outbound KES 9/min stored, not offered until live transfer. | `package_rate_card_ondemand_6_9.sql` | this PR | YES (2026-09-30) | YES (2026-09-30) | NO | Staging and production `id = 1` returned inbound 0.10 and outbound 0.15. SMS 1, email 1, WhatsApp 2, annual discount 17 unchanged. |
| LEDGER-PACKAGE-PRICES | `billing_packages.monthly_price_kes` 5000 / 12000 / 25000, `dids` 1 | Monthly price includes one number. | `package_prices_5_12_25.sql` | this PR | YES (2026-09-30) | YES (2026-09-30) | NO | Staging and production returned Starter 5000, Growth 12000, Scale 25000, each `dids` 1. Seats and minutes unchanged. No wallet debit. |

### Staging-only / proposed (not in standard Git apply)

| ID | What | Why | Where | Staging | Production | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| LEDGER-STAGING-NOTIFY-GRANT | `GRANT UPDATE (notify_channels)` | Desk persistence test | Now in `notify_channels.sql` | YES (2026-08-15) | YES (2026-08-16) | Superseded by `LEDGER-PROD-NOTIFY-GRANT` |
| LEDGER-STAGING-STORAGE | Bucket `call-recordings` | Voice recordings | Manual / Dashboard | YES (2026-08-15) | YES (2026-08-06) | Policies UNKNOWN on both |

### Bulk manual scripts (pre-CLI era)

The following scripts are **INFERRED** applied on production (live schema matches Git intent) but lack per-script apply dates:

`multi_tenant_onboarding.sql`, `owner_rls.sql`, tiers 2–9 per README, wallet chain, `agent_tools.sql`, BI scripts.

| Staging (full rebuild) | Production (per script) |
| --- | --- |
| YES (2026-08-15, Phase 3E) | UNKNOWN (bulk); CLI ledger covers 25 post-adoption changes |

---

## Production ledger backfill (Phase 3G)

**Method:** Evidence from `supabase_migrations.schema_migrations` on ALCR (recorded Phase 3F). **No production SQL executed in Phase 3G.**

CLI version timestamps are **INFERRED** from version string `YYYYMMDDHHMMSS` (UTC). Per-script dates for pre-CLI manual applies remain **UNKNOWN**.

| CLI version | Name | Production applied | Inferred date (UTC) | Git script |
| --- | --- | --- | --- | --- |
| 20260807225947 | daily_bulletin | YES | 2026-08-07 | `daily_bulletin.sql` |
| 20260808005039 | escalation_enabled | YES | 2026-08-08 | `escalation_enabled.sql` (legacy) |
| 20260808053931 | alert_email | YES | 2026-08-08 | `alert_email.sql` |
| 20260808080322 | one_wallet_billing | YES | 2026-08-08 | `one_wallet_billing.sql` |
| 20260808103634 | wallet_security_beta_part1 | YES | 2026-08-08 | `wallet_security_beta.sql` |
| 20260808103644 | wallet_security_beta_part2_rpcs | YES | 2026-08-08 | `wallet_security_beta.sql` |
| 20260808103657 | wallet_security_beta_part3_grants | YES | 2026-08-08 | `wallet_security_beta.sql` |
| 20260808112824 | agent_tools | YES | 2026-08-08 | `agent_tools.sql` |
| 20260811044451 | business_operating_model | YES | 2026-08-11 | `business_operating_model.sql` |
| 20260811044502 | contacts_and_requests | YES | 2026-08-11 | `contacts_and_requests.sql` |
| 20260811061942 | fix_charge_call_wallet_ambiguous | YES | 2026-08-11 | `fix_charge_call_wallet_ambiguous.sql` |
| 20260811072236 | lead_status_archive | YES | 2026-08-11 | `lead_status_archive.sql` |
| 20260811072353 | wallet_soft_spend_limit | YES | 2026-08-11 | `wallet_soft_spend_limit.sql` |
| 20260811073319 | wallet_on_demand_alerts | YES | 2026-08-11 | `wallet_on_demand_alerts.sql` |
| 20260811073341 | wallet_on_demand_alerts_fns | YES | 2026-08-11 | `wallet_on_demand_alerts.sql` |
| 20260811073356 | wallet_claim_alerts_and_ondemand_rpc | YES | 2026-08-11 | `wallet_on_demand_alerts.sql` |
| 20260811102735 | add_tenants_tts_lexicon | YES | 2026-08-11 | `tts_lexicon.sql` |
| 20260811122648 | grant_owner_update_tts_lexicon | YES | 2026-08-11 | `tts_lexicon.sql` |
| 20260811142321 | product_catalog_and_social | YES | 2026-08-11 | `product_catalog_and_social.sql` |
| 20260812025507 | call_resolution | YES | 2026-08-12 | `call_resolution.sql` |
| 20260812083631 | appointments | YES | 2026-08-12 | `appointments.sql` |
| 20260812141513 | soniox_voice_catalog | YES | 2026-08-12 | `soniox_voice_id.sql` |
| 20260813073840 | pronunciation_gemini_scan | YES | 2026-08-13 | `pronunciation_gemini_scan.sql` |
| 20260813210755 | notify_channels | YES | 2026-08-13 | `notify_channels.sql` |
| 20260816180900 | grant_notify_channels_update | YES | 2026-08-16 | `production_pending/grant_notify_channels_update.sql` |

**Manual production applies (evidenced, not in CLI ledger):**

| Script | Production | Date | Evidence |
| --- | --- | --- | --- |
| `fix_p0_rls_remove_legacy_allow_all.sql` | YES | 2026-08-14 | Phase 3F ledger / PR #154 |
| Pre-CLI bulk manual scripts | INFERRED YES | UNKNOWN | Live schema matches Git; no per-script dates |

---

## Answering ledger questions

| Question | Where to look |
| --- | --- |
| What changed? | Change registry **What** column; file header |
| When? | **Staging/Production applied date**; CLI version timestamp |
| Why? | **Why** column; linked PR |
| Where? | **Where** path; `README.md` tier |
| Applied to staging? | **Staging** column |
| Applied to production? | **Production** column; CLI ledger |
| Introducing commit? | **Introduced commit** |
| Verification? | **Verification** column; `STAGING_REBUILD_EXECUTION_REPORT.md` |

---

## Related documents

- [`DATABASE_EVOLUTION.md`](../explanation/database/DATABASE_EVOLUTION.md)
- [`DATABASE_APPLY_ORDER.md`](../how-to/DATABASE_APPLY_ORDER.md)
- [`../operations/STAGING_REBUILD_EXECUTION_REPORT.md`](../archive/STAGING_REBUILD_EXECUTION_REPORT.md)

## Pending (not applied): team invites

| File | Purpose | Status |
| --- | --- | --- |
| `supabase/migrations/20261011000000_team_invites.sql` | Roles owner/admin/staff/viewer (member→staff), one owner per tenant, `tenant_invites`, `tenant_member_audit`, seat/invite/accept/transfer RPCs, restrictive RLS (owner/admin settings; viewer read-only), signup trigger skips invitees. | **Not applied.** Staging first. App flag `TEAM_INVITES_ENABLED` default off. Re-check `handle_new_user_tenant` body against production before applying. |

---

## Recorded drift (18 Oct 2026)

Checked against `supabase_migrations.schema_migrations` and object names only. No tenant rows. This section is the repo record. It does not insert history rows into either database.

| ID | What | Staging | Production | CLI / schema_migrations | Notes |
| --- | --- | --- | --- | --- | --- |
| LEDGER-643-WALLET-ALERT | Tables `voice_wallet_alert_state` and `voice_webhook_events`. Functions `voice_wallet_alert_observe` and `voice_wallet_alert_release`. | Objects present. Not in the migration list. | Objects present. Not in the migration list. | NO on both | SQL stays on open draft #643 (`voice/wallet-low-balance-alert`). Not copied here and not applied by this change. |
| LEDGER-737-LIFECYCLE | `admin_set_business_suspended`, `archive_tenant_billing`, `unarchive_tenant_billing`, `purge_archived_tenants`. | Functions present. Names `admin_business_suspend_737`, `archive_tenant_billing_737`, `purge_archived_tenants_737` are absent from the migration list. | Recorded 18 Oct 2026 12:06 EAT, before merge `fbef28a8` at 12:10 EAT. Versions `20261018090636` `admin_business_suspend_737`, `20261018090641` `archive_tenant_billing_737`, `20261018090646` `purge_archived_tenants_737` (09:06 UTC). | Prod YES. Staging NO. | Purge schedule is on neither list. History rows were not inserted on staging. |
| LEDGER-SEAT-ANON-REVOKE | `revoke` execute on `tenant_seats_used(uuid)` and `tenant_seat_available(uuid)` from `PUBLIC` and `anon`. Keep `authenticated` and `service_role`. | YES 18 Oct 2026. Version `20261018164459`, name `revoke_anon_seat_execute`. Anon call denied. `authenticated` and `service_role` still succeed. | YES 18 Oct 2026. Version `20261018180156`, same name. Anon denied on both functions. | Staging YES (`20261018164459`). Production YES (`20261018180156`). | `supabase/migrations/20261018180000_revoke_anon_seat_execute.sql`. Usage calls `tenant_seats_used` with the service role. |
| LEDGER-INVITE-ANON-REVOKE | `revoke` execute on `create_tenant_invite(uuid, text, text, text, uuid)` from `PUBLIC` and `anon`. Keep `service_role` only. | YES 18 Oct 2026. Version `20261018180447`, name `revoke_anon_create_tenant_invite`. Anon call denied. `service_role` still reaches the function. `authenticated` stays denied. | NO. Same file, after the owner's OK and a backup. Confirmed absent from the production migration list after the staging apply. | Staging YES (`20261018180447`). Production NO. | `supabase/migrations/20261018210000_revoke_anon_create_tenant_invite.sql`. Desk invite uses `getSupabaseAdmin()`. `team_invites.sql` already revoked `PUBLIC` and `authenticated`; the leftover grant is the direct `anon` grant. |
| LEDGER-ACCEPT-TRANSFER-ANON-REVOKE | `revoke` execute on `accept_tenant_invite(text, uuid)` and `transfer_tenant_ownership(uuid, uuid, uuid)` from `PUBLIC` and `anon`. Keep `service_role` only. | YES 18 Oct 2026. Version `20261018180648`, name `revoke_anon_accept_transfer`. Anon denied on both. `service_role` still reaches both. `authenticated` stays denied. | NO. Same file, after the owner's OK and a backup. Confirmed absent from the production migration list after the staging apply. | Staging YES (`20261018180648`). Production NO. | `supabase/migrations/20261018220000_revoke_anon_accept_transfer.sql`. Accept is `inviteAccept.ts`. Transfer is `membersActions.ts`. Both use `getSupabaseAdmin()`. |

## Billing SQL ledger

| ID | What | Why | Where | Introduced commit | Staging | Production | CLI | Verification |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| LEDGER-BILLING-DATA-LAYER | Package versions, `billing_status`, invoices, payments, credits, `billing_notices`, `tenant_escalation_allowed`, DID `quarantine` | Billing data layer. No charges, no send, no voice routing. | `billing_data_layer.sql` | #775 `6edbba92` | YES (2026-10-18, scalers-staging). | YES. P1–P8 as of `553f1830`, plus the owner-price v2 import, are on production. | YES on production for P1–P8 | `invoices_freeze` rejects a draft number or status unless `scalers.billing_write` is `1`. Do not re-apply P1 after P6. |
| LEDGER-INVOICE-PAY-SESSION | One live checkout per part, including `pending_unattached` | P9. Does not replace `finalize_invoice`. | `invoice_pay_session.sql` | this PR | YES. `invoice_pay_session` `20261018233254` on scalers-staging. | YES. Owner confirmed 19 Oct 2026. No production version recorded here. | NO | After P8. |
| LEDGER-BILLING-MODE-LEGAL-PAIRS | `set_tenant_billing_mode` refuses enforcement while `billing_status` is beta | P10. Does not change `billing_status`. | `billing_mode_legal_pairs.sql` | this PR | YES. Staging migration `billing_mode_legal_pairs` `20261018212633`, re-applied as `billing_mode_legal_pairs_p10` `20261019002432`. | YES. Owner confirmed 19 Oct 2026. No production version recorded here. | NO | After P9. Do not re-run `wallet_security_beta.sql`. |
| LEDGER-INVOICE-PAY-HELD | Held checkout, parked session id, one extra credit | P11. Does not replace `finalize_invoice`. | `invoice_pay_held.sql` | this PR | YES. `invoice_pay_held` `20261019011751` on scalers-staging. | YES. 2026-10-19 08:11-08:13 UTC, versions `20261019081159` through `20261019081339`. Do not re-run. | NO | After P10. Anon and authenticated have no execute on `release_held_pay_checkout` or `credit_checkout_extra`. |
| LEDGER-INVOICE-PAY-COLLECTIONS | Per-collection reconcile and hold until Bachs is read closed | P12. Does not replace `finalize_invoice`. The webhook no longer calls `reconcile_checkout_collection`. | `invoice_pay_collections.sql` | this PR | YES. `invoice_pay_collections` `20261019015637` on scalers-staging. | YES. 2026-10-19 08:11-08:13 UTC, versions `20261019081159` through `20261019081339`. Do not re-run. | NO | After P11. Anon and authenticated have no execute on `reconcile_checkout_collection`. |
| LEDGER-INVOICE-PAY-CHECKOUT-TOTAL | Cumulative collected total per checkout | P13. Does not replace `finalize_invoice`. | `invoice_pay_checkout_total.sql` | this PR | YES. `invoice_pay_checkout_total` `20261019025507` on scalers-staging. | YES. 2026-10-19 08:11-08:13 UTC, versions `20261019081159` through `20261019081339`. Do not re-run. | NO | After P12. Anon and authenticated have no execute on `reconcile_checkout_total`. |
| LEDGER-INVOICE-PAY-CHECKOUT-REVIEW | Review a short new collection or a lower Bachs total, and retry an unreadable read | P14. Does not replace `finalize_invoice`. Does not reverse a payment or a credit. | `invoice_pay_checkout_review.sql` | this PR | YES. `invoice_pay_checkout_review` `20261019034233` on scalers-staging. | YES. 2026-10-19 08:11-08:13 UTC, versions `20261019081159` through `20261019081339`. Do not re-run. | NO | After P13. Anon and authenticated have no execute on `settle_checkout_reading`, `open_checkout_total_review`, or `resolve_checkout_total_review`. |
| LEDGER-INVOICE-PAY-CHECKOUT-REVIEW-R8 | Keep a placeholder id, book a rise when the event amount is the session price, and audit resolve | P15. Does not replace `finalize_invoice`. Does not move money on resolve. | `invoice_pay_checkout_review_round8.sql` | this PR | YES. `invoice_pay_checkout_review_round8` `20261019042439` on scalers-staging. | YES. 2026-10-19 08:11-08:13 UTC, versions `20261019081159` through `20261019081339`. Do not re-run. | NO | After P14. Drops `resolve_checkout_total_review(text, text)`. Anon and authenticated have no execute on the four-argument resolve. Do not re-run P5, P9, P11, P12, or P14 after P15. |
| LEDGER-INVOICE-PAY-CHECKOUT-REVIEW-R9 | Book a placeholder collection on resolve, or confirm nothing was collected | P16. Does not replace `finalize_invoice`. A replay does not book again. | `invoice_pay_checkout_review_round9.sql` | this PR | YES. `invoice_pay_checkout_review_round9` `20261019045940` on scalers-staging. | YES. 2026-10-19 08:11-08:13 UTC, versions `20261019081159` through `20261019081339`. Do not re-run. | NO | After P15. Drops the two-argument and four-argument resolve. Anon and authenticated have no execute on the six-argument resolve. Do not re-run P5, P9, P11, P12, P14, or P15 after P16. |
| LEDGER-INVOICE-PAY-LIVE-ALLOWLIST | `billing_live_tenants`, `admin_set_tenant_live_payments`, `billing_live_tenant_allowed` | P17. Live payment allowlist. Requires a reason. Refuses enabling a beta business. Writes `tenant_live_payments_set`. Inserts no businesses. | `invoice_pay_live_allowlist.sql` | #820 `f6d7fee9` | YES. `invoice_pay_live_allowlist` `20261019093619` on scalers-staging (`sgcdncjxauhsbunobmob`). Zero rows. | YES. `20261019150641` via #820 `f6d7fee9`. Do not re-run. | NO | After P16. Anon and authenticated have no table privileges and no execute. RLS is on. |
| LEDGER-PACKAGE-EDITOR-FLAG | `admin_set_package_editor_enabled` | P18. Turns `package_editor_enabled` on or off. Does not call `_package_editor_open`. Requires a reason and confirm. Writes `set_package_editor_enabled`. | `billing_package_editor_flag.sql` | #820 `f6d7fee9` | YES. `billing_package_editor_flag` `20261019113040` on scalers-staging (`sgcdncjxauhsbunobmob`). | YES. `20261019150654` via #820 `f6d7fee9`. Do not re-run. | NO | After P17. Anon and authenticated have no execute. |
| LEDGER-INVOICE-PAY-AMOUNT-PAID-EITHER | `resolve_checkout_total_review` books a per-event collection only when staff choose book on a short rise | P19. Does not replace `finalize_invoice`. A replay does not book again. Not applied by this change. | `invoice_pay_amount_paid_either.sql` | this PR | NO | NO | NO | After P16. Does not depend on P18. Anon and authenticated have no execute on the six-argument resolve. Never re-run P5, P9, P11, P12, P14, P15, P16, P17, or P18. |
| LEDGER-NUMBER-HOLD-WINBACK | `billing_lifecycle_settings.hold_winback_enabled` / `number_hold_days` / `reactivation_fee_kes`, `sautikit_did_pool.winback_hold`, trigger `sautikit_did_pool_winback_guard`, `admin_set_number_hold_settings`, `admin_hold_number_for_winback`, `admin_end_number_hold`, `admin_restore_held_number`, `number_on_winback_hold` | #885. Number hold and win-back (Settings > General, Numbers > Hold). Service role only. | `number_hold_winback.sql` (down: `number_hold_winback_down.sql`) | #885 (draft) | YES. `number_hold_winback` `20261022211546` (23 Oct 2026 00:15 EAT). Settings set to On, 14 days, KSh 1,000 on 24 Oct 2026 through `admin_set_number_hold_settings`. | YES. 27 Oct 2026 15:41 EAT, `number_hold_winback` `20261027124118` (Alvin's yes 15:40 EAT). Then `admin_set_number_hold_settings` set On, 14 days, KSh 1,000 (actor `platform:alvin-approved`, audited 15:41 EAT). | Staging YES (`20261022211546`), Production YES (`20261027124118`) | Anon and authenticated have no execute on any of the six functions (staging and prod ACL `postgres, service_role` only; prod bodies md5-equal to staging). Must run before #968. |
| LEDGER-ADMIN-NUMBER-CONTROLS-V1 | `admin_restore_business_number`, `admin_lift_quarantine`, `admin_move_number`, helpers `_admin_did_last9`, `_admin_did_is_protected`, `_admin_did_refuse_protected`, `_admin_did_tenant_state`, `_admin_did_pool_state`, `_admin_did_assert_no_other_holder` | #968. Admin Numbers: restore, lift quarantine, move (UI #974). DB-only, no SautiKit call. Refuses +254709221536 in any form. | `supabase/migrations/20261027081642_admin_number_controls_v1.sql`, `supabase/migrations/20261027082533_admin_number_controls_v1_1.sql` (same as `docs/supabase/admin_number_controls_v1*.sql`; down: `admin_number_controls_v1_down.sql`) | #968 (draft) | YES. `20261027081642` `admin_number_controls_v1` (27 Oct 2026 11:16 EAT) and `20261027082533` `admin_number_controls_v1_1` (11:25 EAT). Alvin tested move and back on staging 27 Oct 13:14 EAT. | YES. 27 Oct 2026, `admin_number_controls_v1` `20261027124149` (15:41 EAT) and `admin_number_controls_v1_1` `20261027124210` (15:42 EAT), after #885 (Alvin's yes 15:40 EAT). | Staging YES (`20261027081642`, `20261027082533`), Production YES (`20261027124149`, `20261027124210`) | Anon and authenticated have no execute on any of the nine functions (staging and prod ACL `postgres, service_role` only; prod bodies md5-equal to staging). +254709221536 refused; its pool and tenant rows unchanged on prod. |
| LEDGER-ADMIN-NUMBER-CONTROLS-V1-2 | Replaces `admin_restore_business_number`, `admin_lift_quarantine`, `admin_move_number` without the +254709221536 refusal; drops `_admin_did_is_protected`, `_admin_did_refuse_protected` | Alvin 27 Oct 2026 15:54 EAT: "yes we want it release able". 536 behaves like any other number (Unlock, reason, confirm, audit). | `supabase/migrations/20261027125836_admin_number_controls_v1_2.sql` (= `docs/supabase/admin_number_controls_v1_2.sql`; down restores the refusal: `admin_number_controls_v1_2_down.sql`) | this PR (draft) | YES. `20261027125836` `admin_number_controls_v1_2` (27 Oct 2026 15:58 EAT). Dry-run verify: no 42501 for 536; 536 rows unchanged. | YES. `20261027143743` `admin_number_controls_v1_2` (27 Oct 2026 17:37:43 EAT, Alvin's yes 17:36 EAT). | Staging YES, prod YES | Prod: 3 RPC md5 = staging (`20baeaab`/`82b9c919`/`8fae2e9a`), service_role only, helpers dropped, no body mentions 709221536, confirm=false probe: no 42501 (536 same shape as 542); 536 pool row + Grow Tech row unchanged. |
| LEDGER-WRITE-RECEIPTS-PROD | `service_requests.idempotency_key`, `appointments.idempotency_key`, unique `(tenant_id, idempotency_key)` on both, index `appointments_one_open_per_call_service` | `WRITE_RECEIPTS=on` / engines commit path insert `idempotency_key`. Prod variant omits `service_requests_one_open_callback_per_call_item` (1 duplicate open callback on prod, Grow Tech 12 Oct, left untouched) and `create_appointment_superseding` (no caller). | `write_receipts_prod.sql` (from `supabase/migrations/20261014210000_write_receipts.sql` @3fada615); down `write_receipts_prod_down.sql` | promotion candidate | YES (full file) `20261014182100` `write_receipts_20261014210000` | YES. `20261027143703` `write_receipts_prod_w1` (27 Oct 2026 17:37:03 EAT, Alvin's yes 17:36 EAT) | Staging + prod | Columns nullable text, 2 unique constraints, 1 index; 77 service_requests / 0 appointments unchanged. |
| LEDGER-TENANT-AREA-PICKS | `tenant_area_picks` (PK tenant_id,node; FK tenants cascade; fee/note checks), RLS on, no policies, anon/authenticated revoked | Desk areas picker (#930/#964), Brain `loadAreaPicks` | `tenant_area_picks.sql` @43d9870b; down `tenant_area_picks_down.sql` | #930/#964 | YES `20261024110556` (v0 name; row shape via `to_rows`) | YES. `20261027143833` `tenant_area_picks` (27 Oct 2026 17:38:33 EAT) | Staging + prod | Prod: RLS true, 0 policies, grants postgres + service_role only, 4 constraints. `to_rows` and `tenant_area_picks_backfill.sql` NOT applied on prod (do-not-ship). |
| LEDGER-TENANT-AREA-PICKS-PROD-BACKFILL | 3 `ke` rows (unconfirmed) for ALFAAL, Esga, Grow Tech | Prod-only guarded equivalent of the TS mapper output | `tenant_area_picks_prod_backfill_ke.sql` (scoped rollback in header) | promotion candidate | n/a | YES. `20261027143900` `tenant_area_picks_prod_backfill_ke` (27 Oct 2026 17:39:00 EAT) | Prod only | 3 rows, moved_from = legacy ids; tenants area md5 `feb82870` and Grow Tech row unchanged. |
| LEDGER-POLICY-TOPICS | `policy_rules_valid` (wider), `set_policy_topic()` | Desk Policies (#938) per-topic saves | `policy_topics.sql`; down `policy_topics_down.sql` (prod's previous body = the down body, md5 `813d14fa`) | #938 | YES `20261025084246` | YES. `20261027143928` `policy_topics` (27 Oct 2026 17:39:28 EAT) | Staging + prod | Prod md5 = staging (`cee0ac55` / `4787ee00`); `set_policy_topic` security definer, service_role only; check constraint valid, 0 failing rows. |
| LEDGER-SPOKEN-CATALOGUE | `tenants.spoken_catalogue`, `tenant_spoken_catalogue_versions` (RLS, member SELECT policy) | Spoken catalogue (Voice/Brain/Desk on-save) | `supabase/migrations/20261015063255_spoken_catalogue.sql`; down `spoken_catalogue_down.sql` | — | YES `20261015063255` | YES. `20261027143954` `spoken_catalogue` (27 Oct 2026 17:39:54 EAT) | Staging + prod | Prod: RLS true, policy `spoken_catalogue_versions_select_member` (authenticated SELECT), grants service_role + authenticated SELECT; 0 rows. Flags stay off until backfill. |
| LEDGER-SAVE-SPOKEN-CATALOGUE-VERSION | `tenants.live_version`, `compile_error`, one-approved unique index, `save_spoken_catalogue_version()` | One-transaction save for `SPOKEN_CATALOGUE_ON_SAVE` | `supabase/migrations/20261015113748_save_spoken_catalogue_version.sql`; down `spoken_catalogue_down.sql` | — | YES `20261015113748` | YES. `20261027144019` `save_spoken_catalogue_version` (27 Oct 2026 17:40:19 EAT) | Staging + prod | RPC md5 `79a1617c`, security definer, `search_path=''`, service_role only. |
| LEDGER-KB-V2 | `kb_*` tables, tenant KB columns, `kb_upsert_items`, `kb_publish_snapshot`, `kb_search_items`, `kb_record_readiness` | KB v2 (one knowledge base per business), parked 28 Oct | `kb_v2.sql` (2026-10-28.1); down `kb_v2_down.sql`. File on the staging branch only until promotion | #991 | YES `20261028072250` `kb_v2_2026_10_28_1` | **NO** (parked, HANDOVER §4c step 3) | staging only | Recorded 28 Oct from `list_migrations` (read-only) |
| LEDGER-KB-V2-ITEM-STATES | Item states (site visit, paused, not offered, hold, not included) | KB v2 follow-up | `kb_v2_item_states.sql` (.2); down `kb_v2_item_states_down.sql` | #996 | YES `20261028074736` | **NO** (parked) | staging only | as above |
| LEDGER-KB-V2-PASTE-REPLACE | `kb_import_items` (service role only) | Paste a list / Replace | `kb_v2_paste_replace.sql` (.3); down `kb_v2_paste_replace_down.sql` | #998 | YES `20261028083434` `kb_v2_paste_replace` | **NO** (parked) | staging only | as above |
| LEDGER-KB-V2-BRAIN-MODE | `tenants.brain_mode` (+ `_set_by/_set_at/_source`), `tenant_brain_mode_audit`, `set_brain_mode()`, `set_kb_catalogue_complete()` | Retire-old-brain P1 safe mode | `kb_v2_brain_mode.sql` (.4); down `kb_v2_brain_mode_down.sql` | #1008 | YES `20261028140049` `kb_v2_brain_mode_2026_10_28_4` | **NO** (parked) | staging only | as above |
| LEDGER-ADMIN-INVOICE-ACTIONS | Replaces live `enqueue_invoice_*` functions | Admin invoice actions | `admin_invoice_actions.sql`; down: draft #957 | — | YES `20261025092056` | **NO**, held: needs its own yes | staging only | as above |
