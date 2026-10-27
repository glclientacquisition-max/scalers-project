---
owner: ops-billing
last_reviewed: 2026-10-21
---

# Owner call summary (A4): one owner message per call

Ops sender for Brain's `call.summary.ready` event ([`CALL_SUMMARY_EVENT.md`](../../explanation/brain/CALL_SUMMARY_EVENT.md)).
Code: `src/notifications/ownerCallSummary.js` (sender), `src/notifications/ownerSummaryText.js` (EN/SW text).
Regression: HD_8a8aa14db292 (Aris, 19 Oct): 4-5 owner SMS per call, an answered call labelled "missed-call lead",
"Order 10 protractors" sent with no row written. Test: `tests/ownerCallSummary.test.js`.

## Flags (all off by default; staging first)

| Variable | Exact value | Effect |
| --- | --- | --- |
| `CALL_SUMMARY_EVENT` | `on` | Brain emits the event at hangup (Brain's flag). Required by the sender. |
| `OWNER_CALL_SUMMARY` | `on` | The sender runs. Ignored unless `CALL_SUMMARY_EVENT` is on (otherwise every answered call would get only the fallback). |
| `OWNER_SUMMARY_SUPPRESS_LEGACY` | `on` | Stops the old owner sends: the mid-call / recording / hangup / LLM-recovery **lead** (`maybeSendWhatsAppNotification`, "New missed-call lead"), and the per-tool **service_request** and **appointment** staff SMS. Only takes effect while the sender is on, so an owner is never left with no message. Caller SMS, the missed-call text-back to the caller and the escalation teammate alert are unchanged. |

Turn all three on together on Railway staging. Turning `OWNER_SUMMARY_SUPPRESS_LEGACY` off (or the sender off) restores the old sends at once; no data migration.

## Behaviour

1. **One message per call per inbox recipient.** Recipients are the same `staffRecipients('inbox')` set the old lead used.
2. **Settle:** 30 s after the call is finalized (the shared terminal finalizer, before the hangup summary emits), built from the latest stored event. An event emitted mid-call (a visit write persists the summary early) waits for the call end; the hangup re-emit replaces it.
3. **Urgent** (`urgent: true`, an escalation receipt; v2: manager request only): no settle, sends as soon as the call end is known. Still once.
4. **Re-emit** (`{ replaces: true }`) after a send: never resends. The new copy is already on `calls.summary.call_summary_event` for the Desk.
5. **Fallback:** no event 2 min after the call end. Never answered (`failed` / `no_answer`): "Missed call from X". Answered: "Call from X, no details captured". This covers never-answered calls (Brain emits nothing for them). Live-transfer legs are skipped.
6. **Label from `outcome`:** booked = Booking, ordered = Order, callback_needed = Callback needed, info_only = Enquiry, abandoned = Call ended early, escalated = URGENT, missed = Missed call. Only a never-answered call says "missed".
7. **Render:** confirmed receipts render as the booking / order. Unconfirmed: "Interested in X, not confirmed". Unconfirmed callback: "Asked for a callback, number/time not confirmed" + caller phone. Missing slot: "not given". `caller.phone` null: "number not captured". Stock shown only for `in_stock` / `out_of_stock`, else "stock to confirm". Price as a range (`KSh 800-1,200 each`), "price to confirm" with no `unitPrice`. `catalogueId` may be null. The top-level `event` field is ignored. ASCII only (GSM-7). `callLanguage` picks EN or SW.
8. **Channel per person:** WhatsApp session text if the 24 h window is open (`whatsapp_threads.last_inbound_at`), else SMS, else email. Never a WhatsApp template (131042 is still open). Tenant `notify_channels` toggles are honoured.
9. **Dedup:** in-process per call; durable marker `calls.summary.owner_summary_sent_at` (checked before every send, so a restart or second replica does not resend); and one `notify_sends` row per (call, kind `call_summary`, person) through reserve/settle, so the WhatsApp -> SMS -> email fallback can never count twice. No new table.

Desk markers written on the call (`calls.summary` JSON): `owner_summary_sent_at`, `owner_summary_mode` (`summary` / `urgent` / `fallback`), `owner_summary_outcome`, `owner_summary_recipients`, and on success `owner_notify_body`, `owner_notify_channel`, `owner_notify_kind: call_summary`.

## SMS metering fix (same PR)

- **Reserve path** (`reserve_notify_send` applied: staging and prod): units are held on the pending row and released on a failed send (unchanged). New: a failed `settle_notify_send` is retried once. A row left pending blocks a resend (`in_flight`), so it can never double-charge.
- **Legacy path** (RPC missing), Voice `dispatchAlert` and Desk `sendRecordedDeskCallerSms`: was `consume_sms_units` **before** the send, never released on a provider failure, and no reversal when the ledger insert failed, so a resend charged again. Now: read-only allowance precheck (the cap still stops a send) -> provider -> `notify_sends` row (one retry) -> `consume_sms_units` only after the row exists. If the row never lands, the units are never claimed (that is the compensation) and Voice blocks a resend of that message in-process. A duplicate-key insert (a concurrent send already recorded it) never claims again.
- Beta (`billing_enforcement = off`) still meters only. No enforcement change.

No new SQL or RPC shape.
