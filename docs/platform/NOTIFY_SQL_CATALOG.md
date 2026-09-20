# Notify SQL catalog (P2)

**Status:** Live probe 2026-09-20 EAT (Platform via Supabase MCP).  
**Authority:** This probe + Critic vocab [`../product/DELIVERY_VOCAB.md`](../product/DELIVERY_VOCAB.md). Do not invent Product copy.  
**Canonical SQL:** [`../supabase/notify_send_ledger.sql`](../supabase/notify_send_ledger.sql), [`../supabase/sms_allowance.sql`](../supabase/sms_allowance.sql), [`../supabase/whatsapp_threads.sql`](../supabase/whatsapp_threads.sql) per [`../supabase/README.md`](../supabase/README.md) steps 24c–24f.

This file is a catalog and ALCR apply checklist. It does **not** apply SQL. Ops / SQL Editor apply on the target project.

## Projects

| Name | Ref | Region | Role |
| --- | --- | --- | --- |
| ALCR | `fjxcdccgyhnvnnlnovcl` | eu-west-2 | production |
| scalers-staging | `sgcdncjxauhsbunobmob` | eu-west-2 | staging |

Never apply [`../supabase/foundation_bootstrap.sql`](../supabase/foundation_bootstrap.sql) to ALCR.

## Tables

| Object | ALCR | staging | Canonical SQL |
| --- | --- | --- | --- |
| `notify_sends` | MISSING | present | `notify_send_ledger.sql` (24c) |
| `whatsapp_threads` | MISSING | present | `whatsapp_threads.sql` (24f) |
| `whatsapp_messages` | MISSING | present | `whatsapp_threads.sql` (24f) |
| `contacts` | present | present | `contacts_and_requests.sql` |
| `service_requests` | present | present | `contacts_and_requests.sql` |
| `appointments` | present | present | `appointments.sql` |
| `business_locations` | MISSING | MISSING | `business_operating_model.sql` (note only) |
| `business_policies` | MISSING | MISSING | `business_operating_model.sql` (note only) |

## `tenants` columns

| Column | ALCR | staging | Canonical SQL |
| --- | --- | --- | --- |
| `notify_channels` | present | present | `notify_channels.sql` |
| `on_demand_usage_enabled` | present | present | `wallet_on_demand_alerts.sql` |
| `wallet_balance_kes` | present | present | `one_wallet_billing.sql` |
| `billing_enforcement` | present | present | `wallet_security_beta.sql` |
| `sms_included_units` | MISSING | present | `sms_allowance.sql` (24d) |
| `sms_used_units` | MISSING | present | `sms_allowance.sql` (24d) |

## RPCs (spot check)

| Function | ALCR | staging | Canonical SQL |
| --- | --- | --- | --- |
| `charge_call_to_wallet` | present | present | `one_wallet_billing.sql` |
| `consume_sms_units` | not in ALCR spot check | present | `sms_allowance.sql` (24d) |

`package_entitlements.sql` (24e) was **not** in the 2026-09-20 probe. Do not claim it present or missing.

## Implication (verified)

ALCR missing `notify_sends` / SMS allowance / WhatsApp thread tables is the fail-open lie: ledger insert skipped, sends could still go, status could look **sent** without a durable row. Staging already has the notify ledger stack.

Runtime (this PR): missing `notify_sends` or `consume_sms_units` cannot claim **sent**. Skip or persist `escalation_notify.stage=failed` with reason `table_missing` / `rpc_missing`. Desk copy stays “Needs human. Notify failed.” Soft / `desk_only` is not sent. **opened** is not **delivered**. No `delivery_status` on `calls`.

## ALCR apply checklist (additive only)

Apply in the Supabase SQL Editor on ALCR. Re-runs are safe (`if not exists`). Do not rewrite applied foundation SQL. Do not apply `foundation_bootstrap.sql`.

| # | File | Why |
| --- | --- | --- |
| 24c | [`notify_send_ledger.sql`](../supabase/notify_send_ledger.sql) | Durable `notify_sends`. Required before any **sent** claim. |
| 24d | [`sms_allowance.sql`](../supabase/sms_allowance.sql) | `sms_included_units`, `sms_used_units`, `consume_sms_units`, `notify_sends.overage`. |
| 24e | [`package_entitlements.sql`](../supabase/package_entitlements.sql) | README sibling after 24d. Not probed. Not required to stop the sent lie. |
| 24f | [`whatsapp_threads.sql`](../supabase/whatsapp_threads.sql) | `whatsapp_threads` / `whatsapp_messages`. Platform WABA persist. Not voice DID routing. |

`business_locations` / `business_policies` missing on **both** projects. Note only. Not this checklist.

After apply, re-probe tables + `consume_sms_units` before treating ALCR as caught up.

## Honesty map (runtime reasons)

Technical reasons on `escalation_notify.reason` / dispatch. Not Product labels.

| Reason | Meaning | Desk / Critic word |
| --- | --- | --- |
| `table_missing` | `notify_sends` absent | **failed** (“Needs human. Notify failed.”) |
| `rpc_missing` | `consume_sms_units` absent; tenant SMS skipped | **failed** if no other live channel recorded |
| `ledger_unrecorded` | insert failed after provider accept | **failed**. Not sent. |
| `desk_only` | saved on call; no live channel | not sent |
| live channel + ledger row | HTTP 2xx + provider id + `notify_sends` | **sent** |
| DLR / webhook | not claimed here | **delivered** only with DLR; else omit |

## Out of scope

whose-turn, verb cut, contact strip, `VOICE_LIVE_TRANSFER`, Baileys, Instagram, campaigns, Meta Cloud customer send, `delivery_status` on `calls`.
