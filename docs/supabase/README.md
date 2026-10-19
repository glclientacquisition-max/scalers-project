---
owner: platform
last_reviewed: 2026-10-19
---

# Supabase SQL apply order

Canonical index for every file in `docs/supabase/`. Prefer **additive** scripts; re-runs should be safe (`if not exists`, `drop … if exists`, idempotent backfills).

Apply in the **Supabase SQL Editor** (or `psql`) against the target project. Voice engine + Super Admin + signup provisioner use **service_role** (bypasses RLS). Owners use Auth JWT + RLS.

For product notes on wallet/DID, see also:

- [`docs/explanation/billing/ONE_WALLET_BILLING.md`](../explanation/billing/ONE_WALLET_BILLING.md)
- [`docs/explanation/billing/BETA_WALLET_PROGRAM.md`](../explanation/billing/BETA_WALLET_PROGRAM.md)
- [`docs/how-to/PRODUCTION_DID_POOL.md`](../how-to/PRODUCTION_DID_POOL.md)

Production vs staging notify objects: [`docs/reference/platform/NOTIFY_SQL_CATALOG.md`](../reference/platform/NOTIFY_SQL_CATALOG.md). Never apply [`foundation_bootstrap.sql`](./foundation_bootstrap.sql) to ALCR.

---

## Reference only (do not “apply” as a migration)

| File | Role |
| --- | --- |
| [`foundation_bootstrap.sql`](./foundation_bootstrap.sql) | **Production-authoritative / historically-unverified.** Reconstructed foundation CREATE for `tenants`, `calls`, `transcripts` + RLS/grants/trigger snapshot. For staging/greenfield only — **do not apply to ALCR production.** See [`foundation_bootstrap.provenance.md`](./foundation_bootstrap.provenance.md). |
| [`schema.sql`](./schema.sql) | Older introspected live shape notes (2026-08-06). Superseded for bootstrap by `foundation_bootstrap.sql`. |
| [`MIGRATION_LEDGER.md`](./MIGRATION_LEDGER.md) | Dual migration model, CLI ledger, column lineage index. |

---

## Fresh / catch-up apply order

Use this order on a new environment or when catching up an older project. Skip files already applied. Within a tier, numbered steps are ordered; same-tier siblings can run in the listed sequence.

### 0. Foundation (greenfield only)

| # | File | Depends on | Notes |
| --- | --- | --- | --- |
| 0 | [`foundation_bootstrap.sql`](./foundation_bootstrap.sql) | `auth.users`, `uuid-ossp` | Creates `tenants` / `calls` / `transcripts` at current production shape. Then run tier 1+ (additive scripts no-op). |

### 1. Membership + RLS

| # | File | Depends on | Notes |
| --- | --- | --- | --- |
| 1 | [`multi_tenant_onboarding.sql`](./multi_tenant_onboarding.sql) | Live `tenants` (+ signup meta) | `tenant_members`, `owner_user_id`, signup provision trigger |
| 2 | [`owner_rls.sql`](./owner_rls.sql) | `multi_tenant_onboarding.sql` | `current_user_tenant_ids()`, owner policies on members/tenants/calls/transcripts |

### 2. Tenant profile + languages

| # | File | Depends on | Notes |
| --- | --- | --- | --- |
| 3 | [`tenant_business_profile.sql`](./tenant_business_profile.sql) | `multi_tenant_onboarding.sql` | `business_hours`, `services_offered`, `agent_tone` |
| 4 | [`voice_languages.sql`](./voice_languages.sql) | `multi_tenant_onboarding.sql` | Auto `{en,sw,sheng}` + default prompt helper |

### 3. Knowledge acquisition columns

| # | File | Depends on | Notes |
| --- | --- | --- | --- |
| 5 | [`knowledge_acquisition_phase1.sql`](./knowledge_acquisition_phase1.sql) | `tenant_business_profile.sql` | `agent_name`, `team_directory`, `faqs` (+ tone) |
| 6 | [`employee_training.sql`](./employee_training.sql) | `tenant_business_profile.sql` | `unknown_answer_fallback` |
| 7 | [`hours_schedule.sql`](./hours_schedule.sql) | `knowledge_acquisition_phase1.sql` | Structured weekly hours (live open/closed) |
| 8 | [`services_catalog.sql`](./services_catalog.sql) | `knowledge_acquisition_phase1.sql` | Live services catalog JSON |
| 9 | [`after_hours_mode.sql`](./after_hours_mode.sql) | `hours_schedule.sql` | `serve` \| `message` |
| 10 | [`daily_bulletin.sql`](./daily_bulletin.sql) | `services_catalog.sql`, `after_hours_mode.sql` | Temporary bulletin items for CONTEXT HEADER |

### 4. Small additive tenant columns

| # | File | Depends on | Notes |
| --- | --- | --- | --- |
| 11 | [`alert_email.sql`](./alert_email.sql) | `tenants` | Email fallback when WhatsApp unavailable |
| 11a | [`notify_channels.sql`](./notify_channels.sql) | `alert_email.sql` | Owner notify channel prefs (`sms`, `whatsapp`, `email`) plus `authenticated` UPDATE grant |
| 12 | [`tts_lexicon.sql`](./tts_lexicon.sql) | `tenants` | Per-tenant TTS pronunciation overrides (Train pronunciation coach) |
| 12b | [`pronunciation_gemini_scan.sql`](./pronunciation_gemini_scan.sql) | `tts_lexicon.sql` | Gemini Scan review queue + dismissals + run logs (never auto-applies to `tts_lexicon`) |
| 13 | [`soniox_voice_id.sql`](./soniox_voice_id.sql) | `tenants` + `platform_soniox_voices` | Per-tenant voice pick/label + Super Admin curated Soniox catalog |
| 13b | [`greeting_spoken_name.sql`](./greeting_spoken_name.sql) | `soniox_voice_id.sql` | `tenants.spoken_name` and `tenants.greeting_invite`. Empty keeps today's greeting. Not applied by deploy. |

### 5. Owner CRM

| # | File | Depends on | Notes |
| --- | --- | --- | --- |
| 13 | [`lead_status.sql`](./lead_status.sql) | `owner_rls.sql` | `calls.lead_status` + column-scoped owner UPDATE |
| 13b | [`lead_status_archive.sql`](./lead_status_archive.sql) | `lead_status.sql` | Adds `archived` status (Archive action; Done stays `resolved`) |
| 13c | [`call_resolution.sql`](./call_resolution.sql) | `lead_status.sql` | `calls.resolution` + `primary_intent` + `resolution_note` (AI assist outcome; owner may correct) |
| 13d | [`inbox_triage.sql`](./inbox_triage.sql) | `call_resolution.sql` | Owner inbox read/mute/pin/assignee/labels/snooze on `calls`. Expands authenticated UPDATE grant. No owner DELETE. |

### 6. DID pool + Super Admin helpers

| # | File | Depends on | Notes |
| --- | --- | --- | --- |
| 14 | [`did_number_pool.sql`](./did_number_pool.sql) | `tenants` / onboarding | Pool table + `assign_did_from_pool`. Seed `available` rows after apply (see PRODUCTION_DID_POOL) |
| 15 | [`super_admin_ops.sql`](./super_admin_ops.sql) | `did_number_pool.sql` | Release DID / remove business helpers |

### 7. Wallet (Ops) — strict sequence

| # | File | Depends on | Notes |
| --- | --- | --- | --- |
| 16 | [`wallet_metering.sql`](./wallet_metering.sql) | `owner_rls.sql` (and profile era) | Dual-wallet columns + legacy `adjust_tenant_wallet` |
| 17 | [`one_wallet_billing.sql`](./one_wallet_billing.sql) | `wallet_metering.sql` | Single KES wallet, ledger, charge/line RPCs — see ONE_WALLET_BILLING |
| 18 | [`wallet_security_beta.sql`](./wallet_security_beta.sql) | `one_wallet_billing.sql` | Beta defaults, RPC locks, column grants, `ops_audit_log` |
| 18b | [`fix_charge_call_wallet_ambiguous.sql`](./fix_charge_call_wallet_ambiguous.sql) | `one_wallet_billing.sql` | Qualify `tenants.wallet_balance_kes` in `charge_call_to_wallet` early returns (OUT-param shadowing). Safe to re-run. |
| 18c | [`wallet_soft_spend_limit.sql`](./wallet_soft_spend_limit.sql) | `wallet_security_beta.sql` | Optional owner monthly soft budget columns (legacy UI removed; columns harmless) |
| 18d | [`wallet_on_demand_alerts.sql`](./wallet_on_demand_alerts.sql) | `wallet_security_beta.sql` (prefer after 18c) | Automatic low/empty prepaid live alerts + owner on-demand opt-in |
| 18e | [`line_rental_grace.sql`](./line_rental_grace.sql) | `wallet_on_demand_alerts.sql` | Line paid-through, grace window (wallet may go negative), `suspend_line_for_nonpayment` |

### 8. Tool toggles (after wallet column grants)

| # | File | Depends on | Notes |
| --- | --- | --- | --- |
| 19 | [`agent_tools.sql`](./agent_tools.sql) | `tenants`; prefer **after** `wallet_security_beta.sql` | `agent_tools` jsonb + `grant update (agent_tools)` for authenticated |

### 9. Business intelligence / retail

| # | File | Depends on | Notes |
| --- | --- | --- | --- |
| 20 | [`business_operating_model.sql`](./business_operating_model.sql) | `services_catalog.sql` era | `vertical`, `handoff_mode`, `business_locations`, `business_policies` |
| 21 | [`contacts_and_requests.sql`](./contacts_and_requests.sql) | `business_operating_model.sql` | `contacts` + `service_requests` + RLS |
| 21b | [`contacts_owner_insert.sql`](./contacts_owner_insert.sql) | `contacts_and_requests.sql` | Owner INSERT policy on `contacts` (desk add/import) |
| 21c | [`service_request_windows.sql`](./service_request_windows.sql) | `contacts_and_requests.sql` | Hold `window_start` / `window_end` + owner UPDATE grant for `when_text` and windows |
| 22 | [`product_catalog_and_social.sql`](./product_catalog_and_social.sql) | `business_operating_model.sql` | `product_catalog` + `social_handles` (products separate from services) |
| 22b | [`tenant_field_provenance.sql`](./tenant_field_provenance.sql) | `product_catalog_and_social.sql` | GIGO P0: `tenant_field_meta`, audit history, completeness + hold gate RPCs, FAQ status/source demotion. See [`docs/reference/platform/TENANT_FIELD_PROVENANCE.md`](../reference/platform/TENANT_FIELD_PROVENANCE.md). |
| 22c | [`tenant_field_confirm_v2.sql`](./tenant_field_confirm_v2.sql) | `tenant_field_provenance.sql` | GIGO confirm v2: `tenant_field_meta.value_hash`, `confirm_tenant_fields` (batch, max 500, all or nothing), `reopen_tenant_field`. Read only when `FACT_HASH_MODE=on`. Staging first; prod needs Alvin's OK. |
| 22d | [`services_catalog_stable_ids.sql`](./services_catalog_stable_ids.sql) | `tenant_field_confirm_v2.sql` | One-time: stable `svc_` ids on `services_catalog` rows and provenance moved from `catalog.service.<n>` to `catalog.service.<id>`. Run before Brain's `scripts/backfillFactHashes.js`. |
| 23 | [`appointments.sql`](./appointments.sql) | `contacts_and_requests.sql` | Home-services visit bookings (`requested\|confirmed\|cancelled\|done`) + RLS |

### 10. Realtime

| # | File | Depends on | Notes |
| --- | --- | --- | --- |
| 24 | [`realtime_inbox.sql`](./realtime_inbox.sql) | `contacts_and_requests.sql`, `appointments.sql`, `one_wallet_billing.sql` | Adds `calls` / `service_requests` / `appointments` / `tenants` / `wallet_ledger` / `transcripts` to the `supabase_realtime` publication (Live Inbox and the open ticket). Idempotent; no schema, grant, or policy change. Apply by hand. Deploy does not run it. |
| 24b | [`realtime_inbox_replica_identity.sql`](./realtime_inbox_replica_identity.sql) | `realtime_inbox.sql` | `REPLICA IDENTITY FULL` on those three tables so `tenant_id` filters match hangup UPDATEs. Idempotent; no publication, grant, or policy change. |
| 24c | [`notify_send_ledger.sql`](./notify_send_ledger.sql) | `contacts_and_requests.sql` (tenants, calls, `current_user_tenant_ids`) | Append-only `notify_sends`. Staff + caller SMS = tenant. Wallet/outage = platform. Meter only, no charge. |
| 24d | [`sms_allowance.sql`](./sms_allowance.sql) | `notify_send_ledger.sql`, `line_rental_grace.sql` | Included SMS (default 200). Same `on_demand_usage_enabled` as minutes. Beta never blocks. |
| 24e | [`package_entitlements.sql`](./package_entitlements.sql) | `sms_allowance.sql` | Reserved email + seat included columns. No email/invite gate. |
| 24g | [`package_catalog.sql`](./package_catalog.sql) | `package_entitlements.sql` | SKUs, rate card, `tenant_subscriptions`, minutes/WA included columns, `assign_tenant_package`. **`tenants_protect_wallet_columns()` latest.** |
| 24h | [`package_minute_consume.sql`](./package_minute_consume.sql) | `package_catalog.sql` | Hangup `consume_call_seconds`. Included seconds free. On-demand off: meter, no debit. On-demand SMS debit. Does not replace the protect trigger. |
| 24i | [`package_rate_card_ondemand_6_9.sql`](./package_rate_card_ondemand_6_9.sql) | `package_catalog.sql` | Sets the existing rate card to inbound KES 0.10/sec and outbound KES 0.15/sec. Does not change package prices. |
| 24j | [`package_prices_5_12_25.sql`](./package_prices_5_12_25.sql) | `package_catalog.sql` | Monthly prices KES 5,000 / 12,000 / 25,000. Each package includes 1 number. |
| 24k | [`admin_billing_ops.sql`](./admin_billing_ops.sql) | `package_catalog.sql`, `wallet_security_beta.sql` | Admin waive on-demand overage (`ops_audit_log`). Grant moved to 24k.1. |
| 24k.1 | [`fix_grant_package_minutes.sql`](./fix_grant_package_minutes.sql) | `package_catalog.sql`, `admin_billing_ops.sql` | Hotfix: `grant_tenant_package_minutes` raised 42702 (OUT param `minutes_included` shadowed the column) on every call. Adds `tenant_minute_grants` (period-scoped, idempotent per key) + audit row. Safe to re-run. |
| 24k.2 | [`package_state_rules.sql`](./package_state_rules.sql) | `fix_grant_package_minutes.sql`, `package_catalog.sql` | DRAFT. Explicit no package (`status = cancelled`, never unlimited), `unassign_tenant_package`, upgrade now (prorated, grants kept) / downgrade + period change at next period (`pending_*`), single grant-expiry rule `billing_grant_minutes_for_period`. Re-run `package_period_rollover.sql` after it. |
| 24k.3 | [`tenant_billing_state.sql`](./tenant_billing_state.sql) | `package_state_rules.sql`, `owner_rls.sql` | DRAFT. `tenant_billing_state` view (security invoker) for the Admin period card and Desk banners, plus owner read policies. Re-run after `notify_send_reserve_settle.sql` to bill SMS from the ledger. |
| 24k.4 | [`billing_data_layer.sql`](./billing_data_layer.sql) | `package_state_rules.sql`, `tenant_billing_state.sql`, `did_number_pool.sql`, `super_admin_ops.sql` | P1. Versioned packages, billing status, invoices, payments, credits, billing notice outbox, `tenant_escalation_allowed`, DID quarantine. Does not charge and does not send. Replaces assign/release. Does not set `billing_status` NOT NULL (that is P2). `invoices_freeze` rejects a draft number or status change unless `scalers.billing_write` is `1`. Production has this file. Do not re-apply it after P6. |
| 24k.5 | [`package_version_editor.sql`](./package_version_editor.sql) | `billing_data_layer.sql` | P7. Super Admin draft, edit, publish, and archive of a package version, including the trial. One message-credit allowance and a burn rate per channel. Stores annual price, credit price, and the default spend-limit share on the version. Extra-seat price is edited only when that column already exists. Published rows stay frozen. A new subscription pins the latest version. An existing business keeps its version number, including when the package changes, unless an admin confirms a move. An admin move can land any business on any published version and leaves beta and enforcement unchanged. A system move skips a beta business. Nothing turns enforcement on except `admin_set_tenant_billing_mode` with confirm, and only as active with soft or hard. Beta stays with enforcement off. Production has this file. Re-apply it after any re-apply of `billing_data_layer.sql`. Contract: [`PACKAGE_VERSIONS_API.md`](../reference/operations/PACKAGE_VERSIONS_API.md). |
| 24k.5b | [`package_version_owner_prices.sql`](./package_version_owner_prices.sql) | `package_version_editor.sql` | Owner-price v2 import. Publishes the owner price table as the next version of Starter, Growth, Scale, and the trial. Does not move a business, enable enforcement, or create an invoice. New subscriptions pin these versions. Idempotent. Production has this import. |
| 24k.6 | [`owner_billing_actions.sql`](./owner_billing_actions.sql) | `billing_data_layer.sql`, then re-apply after `package_minute_consume.sql` and `notify_send_reserve_settle.sql` | P3 is the extra-seat backfill in this file. P4 is the rest. Owner plan change, extra seats, spend limit. Service role only. Beta returns `beta` and writes no invoice. No payment provider. Desk stays behind `DESK_PLAN_CHANGE` (off). Production has this file. Re-applying it replaces `finalize_invoice`, so re-apply [`billing_company.sql`](./billing_company.sql) last. Prod script is [`prod/owner_billing_actions.sql`](./prod/owner_billing_actions.sql). |
| 24k.7 | [`invoice_pay.sql`](./invoice_pay.sql) | `billing_data_layer.sql` | P5. Pay tokens (hash only), split M-Pesa parts, checkout expiry, issue payments, report-only reconciliation. `apply_payment` sets `scalers.billing_write` before it writes invoice status. Does not call Bachs. `payment_attempts.updated_at` is added nullable, backfilled, then defaulted. Production has this file as of commit `553f1830`. Do not edit it in place. |
| 24k.8 | [`invoice_documents.sql`](./invoice_documents.sql) | `invoice_pay.sql` | P6. Nullable `tax_kes`, receipts `RCT-YYYY-000001`, and billing notice kinds for issued, due soon, payment received, and overdue. Does not define `finalize_invoice`. An overpay updates the existing receipt amount and does not mint a second number. Does not charge and does not send. Production has this file as of commit `553f1830`. Do not edit it in place. |
| 24k.9 | [`billing_company.sql`](./billing_company.sql) | `invoice_documents.sql` | P8. Canonical `finalize_invoice`: `scalers.billing_write`, `SCL-YYYY-NNNNNN`, letterhead snapshot, beta refusal, and a negative draft becomes one `tenant_credits` row (`invoice-credit:<id>`) plus a paid zero invoice. Production has this file as of commit `553f1830`. Do not edit it in place. Re-apply this file last whenever another file replaces `finalize_invoice`. |
| 24k.10 | [`invoice_pay_session.sql`](./invoice_pay_session.sql) | `billing_company.sql` | P9. After P8. One live checkout per part (`pending` and `pending_unattached`), `park_invoice_pay_attempt`, and `live_part` on the checkout lookup. Does not replace `finalize_invoice`. Staging: `invoice_pay_session` (`20261018233254`). Production has this file (owner confirmed 19 Oct). |
| 24k.11 | [`billing_mode_legal_pairs.sql`](./billing_mode_legal_pairs.sql) | `wallet_security_beta.sql`, `billing_data_layer.sql` | P10. After P9. Replaces `set_tenant_billing_mode` so soft or hard is refused while `billing_status` is beta. Does not change `billing_status`. Does not replace `finalize_invoice`. Staging: `billing_mode_legal_pairs` (`20261018212633`), re-applied as `billing_mode_legal_pairs_p10` (`20261019002432`). Production has this file (owner confirmed 19 Oct). Do not re-run `wallet_security_beta.sql` to pick up this check. |
| 24k.12 | [`invoice_pay_held.sql`](./invoice_pay_held.sql) | `invoice_pay_session.sql` | P11. After P10. A succeeded checkout that has not expired holds its part. `park_invoice_pay_attempt` refuses a different session id. A later collection on that checkout is one `checkout-extra` credit. Does not replace `finalize_invoice`. Staging only. Not on prod. Superseded on the hold and the extra credit by P12. Do not re-run P9 after P11. |
| 24k.13 | [`invoice_pay_collections.sql`](./invoice_pay_collections.sql) | `invoice_pay_held.sql` | P12. After P11. Holds a succeeded checkout until `checkout_closed_at` is set, including after `checkout_expires_at`. `reconcile_checkout_collection` stays for compatibility. The webhook no longer calls it. Does not replace `finalize_invoice`. Staging: `invoice_pay_collections` (`20261019015637`). Not on prod. |
| 24k.14 | [`invoice_pay_checkout_total.sql`](./invoice_pay_checkout_total.sql) | `invoice_pay_collections.sql` | P13. After P12. Adds `payment_attempts.collected_total_seen_kes` and `reconcile_checkout_total`. The webhook is a trigger. The function applies Bachs' cumulative collected total for one checkout. The delta above the seen total is applied up to the amount due. Excess is one credit keyed by the checkout and the cumulative cents. Does not replace `finalize_invoice`. Staging: `invoice_pay_checkout_total` (`20261019025507`). Not on prod. |
| 24k.15 | [`invoice_pay_checkout_review.sql`](./invoice_pay_checkout_review.sql) | `invoice_pay_checkout_total.sql` | P14. After P13. A new receipt or charge id that the GET total does not cover, or a GET total below the seen total, writes one review issue and blocks the next checkout until `resolve_checkout_total_review`. Does not reverse a payment or a credit. Adds `payment_attempts.collection_ids` and `payment_events.needs_retry`. Does not replace `finalize_invoice`. Staging: `invoice_pay_checkout_review` (`20261019034233`). Not on prod. Do not re-run P9 after P14. |
| 24l | [`platform_ops_notices.sql`](./platform_ops_notices.sql) | none (staff tables) | Staff notice settings + open notices. Service role only. Applied on scalers-staging and production. The ops cron adds no columns: threshold notices are extra `kind` values. `ops_alerts_prod_later.sql` (added by the ops alerts pull request) is a read-only check, not a migration. |
| 24m | [`platform_ops_people.sql`](./platform_ops_people.sql) | `platform_ops_notices.sql` | Escalate people jsonb (name, phone, email). Applied on scalers-staging with the Platform rebuild. |
| 24n | [`voice_turn_traces.sql`](./voice_turn_traces.sql) | `platform_ops_people.sql` | Per-turn voice traces (`voice_turn_traces`) plus call `score`, `checks`, `diagnosis`, and `release`. Service role only. Not applied by deploy. Apply the whole file on staging before `VOICE_TRACE` can persist. Re-running it adds the score columns if an earlier draft of the table is already there. |
| 24o | [`calls_inbox_assignee.sql`](./calls_inbox_assignee.sql) | `inbox_triage.sql` | Optional. `calls.inbox_assignee_name` / `inbox_assignee_phone` (text, nullable). Already on scalers-staging (manual, 2026-10); file written to match. Not on prod. |
| 24p | [`voice_turn_traces_cron.sql`](./voice_turn_traces_cron.sql) | `voice_turn_traces.sql`, `voice_turn_traces_created_at_idx.sql` | Enables pg_cron and schedules `call purge_voice_turn_traces_batched(30)` daily at 00:17 UTC (03:17 EAT). Applied on prod 2026-10-09 13:38 EAT with Alvin's GO (job id 1 now runs the CALL). Not on staging (no pg_cron). |
| 24q | [`voice_turn_traces_created_at_idx.sql`](./voice_turn_traces_created_at_idx.sql) | `voice_turn_traces.sql` | Index on `voice_turn_traces(created_at)` for the purge. Plain CREATE INDEX (table is tiny); file explains when to use CONCURRENTLY. Applied on scalers-staging and prod 2026-10-09. Partitioning plan: [`docs/rfcs/voice-turn-traces-partitioning.md`](../rfcs/voice-turn-traces-partitioning.md). |
| 24r | [`admin_business_archive.sql`](./admin_business_archive.sql) | `super_admin_ops.sql` | `tenants.archived_at` / `archived_by` for Super Admin Archive (A0). Permanent delete opens 30 days after `archived_at`. Not applied anywhere yet. Admin works without it (archive sets `is_active = false`; permanent delete stays off). |
| 24v | [`voice_platform_audio.sql`](./voice_platform_audio.sql) | none | SautiKit-hosted line-unavailable clips for `<Play>` (#639): presigned url + expires_at per clip key. Service role only. Not applied by deploy. Apply on staging before the clip refresh can store URLs; until then closed lines use `<Say>`. |
| 24w | [`package_period_rollover.sql`](./package_period_rollover.sql) | `package_catalog.sql`, `wallet_security_beta.sql`, `package_minute_consume.sql`, `notify_send_reserve_settle.sql`, pg_cron | Applied 17 Oct (#631/#650); 18 Oct catch-up fix is a DRAFT. Hourly pg_cron job: roll ended `tenant_subscriptions` periods forward. On-time roll zeroes `seconds_used`, `sms_used_units`, `email_used_units`, `whatsapp_used_units`; a catch-up roll rebuilds seconds and SMS for the new period from `calls.package_seconds_applied` and `notify_sms_billable`. Dry run: `select * from roll_package_periods(true)`. |
| 24w.1 | [`on_demand_usage_audit.sql`](./on_demand_usage_audit.sql) | `wallet_on_demand_alerts.sql`, `wallet_security_beta.sql` | DRAFT. `set_tenant_on_demand_usage` writes an `ops_audit_log` row (`set_on_demand_usage`: actor, before, after). Re-run after any re-run of `wallet_on_demand_alerts.sql`. |
| 24s | [`admin_business_suspend.sql`](./admin_business_suspend.sql) | `line_rental_grace.sql`, `admin_business_archive.sql` | Super Admin Suspend / Restore line. Reuses `tenants.line_status = 'suspended'` (voice gate #651 already refuses those calls before any call row) plus `suspended_at` / `suspended_by`. RPC `admin_set_business_suspended` (service role); refuses to lift a non-payment suspension. Also replaces `refresh_line_status` / `suspend_line_for_nonpayment` (only where they exist) so rental rules keep `suspended` while `suspended_at` is set. Staging applied 2026-10-17. Prod applied 2026-10-18 (Alvin's GO; prod has no `refresh_line_status`, so only the RPC and columns landed). |
| 24x | [`purge_archived_tenants.sql`](./purge_archived_tenants.sql) | `admin_business_archive.sql` | `purge_archived_tenants(p_days, p_dry_run default true, p_tenant_id)` deletes calls, contacts and playbook facts of businesses archived longer than the restore window (30 days, `ARCHIVE_RESTORE_DAYS`); keeps billing, usage, audit and the tenant row. Skips a business while its recordings are still in storage. Lets `notify_sends_deny_mutation` accept the purge's blanking (body, recipient, call_id) for archived businesses only, and writes a per-month calls usage summary into the audit row. Service role only. Staging applied 2026-10-17, prod applied 2026-10-18 (Alvin's GO). Dry runs only; never scheduled. |
| 24y | [`purge_archived_tenants_schedule.sql`](./purge_archived_tenants_schedule.sql) | `purge_archived_tenants.sql` | pg_cron nightly purge (03:15 EAT). **Not applied anywhere.** Needs Alvin's GO and the recording cleanup first. |
| 24z | [`archive_tenant_billing.sql`](./archive_tenant_billing.sql) | `admin_business_archive.sql`, `wallet_on_demand_alerts.sql` | `archive_tenant_billing` (on Archive: billing mode off, on-demand off, line rental stops, rollover skips archived, one audited row; invoice hook documented, no invoice table yet) and `unarchive_tenant_billing` (on Unarchive: audit only, turns nothing back on). Trigger `tenants_archived_billing_guard` refuses billing/on-demand on while archived. Service role only. Staging applied 2026-10-17, prod applied 2026-10-18 (Alvin's GO). |
| 24f | [`whatsapp_threads.sql`](./whatsapp_threads.sql) | `notify_send_ledger.sql` | Platform two-way WhatsApp persist (`whatsapp_threads` / `whatsapp_messages`). Service role only. Not voice DID routing. |

---

## Production billing apply order

Production already has P1–P10 (P1–P8 as of commit `553f1830`, P9 and P10 owner confirmed 19 Oct) and the owner-price v2 import (`package_version_owner_prices.sql`). Do not edit P5, P6, or P8 in place. Do not re-run the whole of P1 after P7: the published feature freeze rejects that seed. P1's `finalize_invoice` installer still skips a body that already numbers `SCL-`. Do not re-run P9 after P11, P12, P13, or P14.

Remaining production apply, in this order, after a backup and Alvin's GO.

| # | File | What it must leave behind |
| --- | --- | --- |
| P11 | [`invoice_pay_held.sql`](./invoice_pay_held.sql) | Replaces `create_invoice_pay_attempt` so a succeeded checkout that has not expired returns `held`. Replaces `park_invoice_pay_attempt` so a different session id raises `checkout session is already parked`. Adds `release_held_pay_checkout` and `credit_checkout_extra` (`checkout-extra:<provider>:<ref>`, one row). Does not replace `finalize_invoice`. Do not re-run P9 after P11. |
| P12 | [`invoice_pay_collections.sql`](./invoice_pay_collections.sql) | Adds `payment_attempts.checkout_closed_at`. Replaces `create_invoice_pay_attempt` so a succeeded checkout with no `checkout_closed_at` stays held after expiry. Replaces `release_held_pay_checkout` to set that column. Adds `reconcile_checkout_collection`. Does not replace `finalize_invoice`. Do not re-run P9 after P11 or P12. |
| P13 | [`invoice_pay_checkout_total.sql`](./invoice_pay_checkout_total.sql) | Adds `payment_attempts.collected_total_seen_kes` and `reconcile_checkout_total`. Applies one cumulative collected total per checkout. The delta above the seen total is applied up to the amount due. Excess is one credit keyed by the checkout and the cumulative cents. Does not replace `finalize_invoice`. Do not re-run P9 after P13. |
| P14 | [`invoice_pay_checkout_review.sql`](./invoice_pay_checkout_review.sql) | Adds `payment_attempts.collection_ids` and `payment_events.needs_retry`. `settle_checkout_reading` opens one review when a new collection is not covered or the GET total falls, and does not reverse the books. `create_invoice_pay_attempt` keeps the P12 hold and raises `checkout total needs review` before a new insert. `resolve_checkout_total_review` lifts that hold. Does not replace `finalize_invoice`. Do not re-run P9 after P14. |

If a later file replaces `finalize_invoice`, re-apply [`billing_company.sql`](./billing_company.sql) last so the `SCL-` letterhead function wins.

P1–P10, already applied. P3 and P4 are one file. Run that file once. P9 and P10 are on production (owner confirmed 19 Oct). No production migration version is recorded here for those two.

| # | File | What it left behind |
| --- | --- | --- |
| P1 | [`billing_data_layer.sql`](./billing_data_layer.sql) | Versions, invoices, notices. `invoices_freeze` rejects a draft number or status change unless `scalers.billing_write` is `1`. Its own `finalize_invoice` is `SC-` and sets that flag. If the installed body already contains `SCL-`, P1 leaves it alone. |
| P2 | [`billing_data_layer_billing_status_not_null.sql`](./billing_data_layer_billing_status_not_null.sql) | `billing_status` NOT NULL. On production the three statements (`NOT VALID`, `VALIDATE`, `SET NOT NULL`) were separate transactions. |
| P3 | extra-seat backfill inside [`owner_billing_actions.sql`](./owner_billing_actions.sql) | Sets `extra_seat_monthly_kes = 500` with the freeze triggers disabled, then turns them back on. Same file as P4. |
| P4 | [`owner_billing_actions.sql`](./owner_billing_actions.sql) | Owner plan, seats, and spend. Re-applying it replaces `finalize_invoice`. |
| P5 | [`invoice_pay.sql`](./invoice_pay.sql) | Pay attempts, tokens, reconciliation, as of `553f1830`. `apply_payment` sets `scalers.billing_write` before a status write. |
| P6 | [`invoice_documents.sql`](./invoice_documents.sql) | Receipts and notice kinds, as of `553f1830`. Does not replace `finalize_invoice`. |
| P7 | [`package_version_editor.sql`](./package_version_editor.sql) | Version editor and the version freeze. |
| P8 | [`billing_company.sql`](./billing_company.sql) | Canonical `finalize_invoice`, as of `553f1830`. |

Owner-price v2 (`package_version_owner_prices.sql`) is already on production. It is not part of P1–P10 and it is not in the remaining list.

Proof: `tests/sql/billing_apply_order/run.sh` on a throwaway local database. It applies P1–P14 from this checkout, then issues from `owner_change_plan`, `owner_set_extra_seats` (negative draft), and `finalize_invoice`.

Rollback of P1 and P2 is [`billing_data_layer_down.sql`](./billing_data_layer_down.sql). It drops the layer. Do not run it on staging or production unless that removal is the point.

---

## Legacy / do not apply

| File | Status |
| --- | --- |
| [`escalation_enabled.sql`](./escalation_enabled.sql) | **Legacy stub.** App does not read this Telegram-era toggle. Safe to leave any existing column; do not re-wire product UI to it. |

---

## Security repairs

| File | Depends on | Notes |
| --- | --- | --- |
| [`fix_p0_rls_remove_legacy_allow_all.sql`](./fix_p0_rls_remove_legacy_allow_all.sql) | `owner_rls.sql`, `lead_status.sql` member policies already applied | **P0 (2026-08-14).** Drops legacy `Enable all access for service role only` policies on `tenants`, `calls`, `transcripts`. Applied on production ALCR. Does not revoke anon grants. |

---

## Invariants (Platform)

1. Scripts are additive and ordered; document new files here **and** in the SQL header (`-- Run after …`).
2. Service role keys stay server-only — never `NEXT_PUBLIC_*`.
3. Tenant isolation via `tenant_members`; no cross-tenant owner policies.
4. Keep the voice DB surface in `src/db.js` stable (`upsertCall`, `chargeCallToWallet`, …).
5. New wallet/DID RPC shapes: Ops specifies behavior; Platform lands SQL + `src/db.js` contracts.

---

## How to add a new migration

1. Add `docs/supabase/<name>.sql` with ASCII-only SQL and a header: purpose + **exact predecessor** file(s).
2. Insert it into the table above at the correct dependency step (do not renumber historical production applies — append with a clear “after X” note).
3. If Ops/Brain/Desk consume the change, link from their lane doc or product doc.
4. Prefer expanding columns/RPCs over breaking `src/db.js` call sites.
