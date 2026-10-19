---
owner: platform
last_reviewed: 2026-10-19
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
| LEDGER-CONTACTS-INSERT | Owner INSERT on `contacts` | Desk add + CSV import | `contacts_owner_insert.sql` | this PR | YES (2026-09-09) | NO | NO | Policy `contacts_insert_member` |
| LEDGER-HOLD-WINDOWS | `service_requests.window_start` / `window_end` + When grant | Desk When+Save dual write | `service_request_windows.sql` | this PR | NO | NO | NO | Not applied yet. Desk falls back to `when_text` if columns missing. |
| LEDGER-REALTIME-INBOX | `supabase_realtime` publication += `calls`, `service_requests`, `appointments` | Live Inbox desk updates | `realtime_inbox.sql` | `bb6bb6c` (#279) | YES (2026-09-16) | YES (2026-09-16) | NO | Staging INSERT+UPDATE probe; production `pg_publication_tables` lists `appointments`, `calls`, `service_requests` |
| LEDGER-REALTIME-DESK | `supabase_realtime` publication += `tenants`, `wallet_ledger`, `transcripts` | Landed credit, minute change, and a new transcript line reach the owner desk | `realtime_inbox.sql` | this PR | NO | NO | NO | Apply by hand. Deploy does not run it. Member SELECT already exists. |
| LEDGER-REALTIME-INBOX-REPLICA | `REPLICA IDENTITY FULL` on `calls`, `service_requests`, `appointments` | Filtered hangup UPDATEs reach Live Inbox | `realtime_inbox_replica_identity.sql` | this PR | YES (2026-09-16) | YES (2026-09-16) | NO | `pg_class.relreplident = 'f'` on the three tables |
| LEDGER-NOTIFY-SENDS | Append-only `notify_sends` | Meter staff/caller SMS vs platform wallet/outage | `notify_send_ledger.sql` | `821980a` (#296) | YES (2026-09-17) | NO | NO | Table + RLS; `to_regclass` = `notify_sends` |
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
| LEDGER-INVOICE-PAY-HELD | Held checkout, parked session id, one extra credit | P11. Does not replace `finalize_invoice`. | `invoice_pay_held.sql` | this PR | YES. `invoice_pay_held` `20261019011751` on scalers-staging. Six tenants, zero invoices, 2026 counter still 5. | NO | NO | After P10. Anon and authenticated have no execute on `release_held_pay_checkout` or `credit_checkout_extra`. |
| LEDGER-INVOICE-PAY-COLLECTIONS | Per-collection reconcile and hold until Bachs is read closed | P12. Does not replace `finalize_invoice`. The webhook no longer calls `reconcile_checkout_collection`. | `invoice_pay_collections.sql` | this PR | YES. `invoice_pay_collections` `20261019015637` on scalers-staging. Six tenants, zero invoices, 2026 counter still 5. | NO | NO | After P11. Anon and authenticated have no execute on `reconcile_checkout_collection`. |
| LEDGER-INVOICE-PAY-CHECKOUT-TOTAL | Cumulative collected total per checkout | P13. Does not replace `finalize_invoice`. | `invoice_pay_checkout_total.sql` | this PR | YES. `invoice_pay_checkout_total` `20261019025507` on scalers-staging. Six tenants, zero invoices, 2026 counter still 5. | NO | NO | After P12. Anon and authenticated have no execute on `reconcile_checkout_total`. |
