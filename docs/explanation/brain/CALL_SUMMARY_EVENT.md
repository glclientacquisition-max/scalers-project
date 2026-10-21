---
owner: brain
last_reviewed: 2026-10-21
---

# `call.summary.ready` — contract v1 (A4: one owner summary per call)

Agreed Brain ⇄ Ops, 21 Oct 2026. Alvin approved A4 (Chief, 10:37 EAT) and Brain's build (11:44 EAT).
Brain owns outcome, receipts, slots and the emitter. Ops owns the sender, dedup, channel, settle, billing and fallback
(`/workspace/briefs/a4-owner-summary-sender-spec.md`).

Code: `src/conversation/callSummaryEvent.js` (pure builder, validator, v1 receipts, emitter),
`src/conversation/v2/summaryReceipts.js` (v2 receipts, from `v2/machine.js` `finishCall`). Flag `CALL_SUMMARY_EVENT`, **off by default**.

## Emission

- Event name `call.summary.ready`, emitted **once per call at call end** from the hangup summary write
  (`writeHangupSummary` → `emitHangupCallSummary` in `server.js`, inside the run-once finalizer). v1 always.
  v2 (branch of record, C3 #853): when **BRAIN_V2_OWNS_CALL** owns the call, A4 reads C3's **cached once-only finish
  result** (`ownsCall.a4V2Source` → `ownedV2Calls.finished(callSid)`), never a second `finishCall`. With
  CALL_SUMMARY_EVENT on, that one `machine.finishCall(state, { profile })` also returns `summaryReceipts`, which the C3
  `summaryPatch` stores as `brain_v2.summary_receipts`. If the finish is still waiting out the 90 s reconnect grace
  (provisional close), the summary waits and `finishOwnedV2Call` emits it when the one finish runs. A call v2 does not
  own (flag off, no owned turn, or `finish_failed`) uses the v1 receipts (`path: 'v1'`).
- v2 receipts read **C1 write receipts** (`state.writeReceipts`, phases proposed / confirmed / committed / failed, by
  idempotency key). A `failed` phase, or a failed machine receipt, is never `confirmed` and never gives a
  `writtenRowId` or `booked`. A commit counts only with both `confirmed` and `committed` phases. An idempotent replay
  (`duplicate`) is not a second receipt. With C1 off there are no write receipts and the machine receipt decides.
- Items: `itemFromCatalogue` on the tenant profile today. **Once C2 (#854, fact store) is in, items should come from
  `itemFromFacts`** (the typed facts compiled at Save), keeping the catalogueId rule (real id or null).
- **Idempotent per `callId`.** A re-emit replaces the stored copy and hooks see `{ replaces: true }`.
  Once a send has gone out, a re-emit **never** causes a second send. The new version is for the Desk only.
- Sinks (no migration needed):
  1. stored on the call row: `calls.summary` JSON key `call_summary_event` (latest wins), via `db.mergeCallSummaryMeta`;
  2. in-process hook `onCallSummaryReady(fn)`, where `fn(event, { replaces })` is Ops' sender entry point.
- Staging (scalers-staging) has **no events/outbox table** (checked read-only 21 Oct; closest are `notify_sends`, which has
  `idempotency_key`, `call_facts` and `voice_webhook_events`). A durable outbox is optional; the DDL proposal is below, not applied.
- Flag off: nothing is built or stored. `brainState` keeps its old shape, and the existing owner SMS/WhatsApp behaviour is unchanged.

## Shape (schemaVersion 1)

```js
{
  event: 'call.summary.ready',   // final (Ops ruling 21 Oct)
  schemaVersion: 1,
  path: 'v1' | 'v2',
  callLanguage: 'en' | 'sw',
  callId,            // calls.id (uuid); falls back to the call sid if the row is missing
  tenantId,
  outcome: 'booked' | 'ordered' | 'callback_needed' | 'info_only' | 'abandoned' | 'missed' | 'escalated',
  urgent: boolean,   // true ONLY if an escalation receipt exists
  caller: { name?, phone },        // phone = E.164 (+2547…) or null (not captured / not normalisable); no other keys
  receipts: [{
    receiptId,
    type: 'booking' | 'order' | 'callback' | 'quote' | 'complaint' | 'escalation',
    status: 'confirmed' | 'unconfirmed',
    writtenRowId?,   // appointments.id / service_requests.id actually written
    slots: { <name>: { value?, status: 'given' | 'not_given' } },
    items?: [{ catalogueId /* real catalogue id or null */, name, qty: { value?, status }, unitPrice?: { min, max, unit }, stock: 'in_stock' | 'out_of_stock' | 'unconfirmed' }]
  }],
  escalationReason?, // present iff an escalation receipt exists
  emittedAt          // ISO 8601 (UTC)
}
```

Field sources: `callId` = `db.getCall(...).id` (`calls.id`), `tenantId` = `.tenant_id`, `caller.phone` = `.from_number` (shapeCall's name for `calls.caller_number`), else a raw `caller_number`, else the brain state's caller phone, then E.164 or null (`callerPhoneFrom`).

Slots used: booking `service, when, place, name`; order `pickup, name` plus `items`; callback/quote/complaint/escalation `reason, name`.

## Rules (enforced by `validateCallSummaryEvent`)

1. **Confirmed** booking / order / quote = a read-back, then an explicit, whole-answer yes, **and** a row written (`writtenRowId`). *(Final, Ops ruling 21 Oct.)*
   - v2: commits only run on the redeemed `confirm_token`, and a row id must come back.
   - v1: the transcript needs an agent read-back cue followed directly by a whole-answer yes. "Okay wait…", "Sawa lakini…?" and "Yes but make it three" are not yes.
   - A written row with no read-back stays `unconfirmed` (HD_e75a669780d4).
2. **Callback** receipts are `confirmed` only when the agent read back **both the number and the time**, the caller gave an explicit yes (repeating the read-back time counts as yes; "okay wait", a question or "but" does not), **and** the callback write succeeded. Otherwise `unconfirmed`. Either way the outcome is `callback_needed`, never urgent. On the old path, no read-back evidence in the transcript means `unconfirmed`. On BA v2, the receipt keeps the spoken read-back line and the caller's reply. With C1 commit safety on (BRAIN_V2_COMMIT_SAFETY, or BRAIN_V2_OWNS_CALL), the callback read-back says the number and when ("…call you back on 0700 000 001, today before 18:00?" / "…kwa namba 0700 000 001, leo kabla ya saa kumi na mbili jioni. Ni sawa?"), and C1's `confirmed` phase is the yes, so v2 callbacks can be `confirmed`. "During working hours" / "wakati wa saa za kazi" (no hours on file) is not a time, so that callback stays `unconfirmed`. A repeated callback window gets one yes/no re-ask from C1, and only the yes after it confirms. With C1 off the handoff read-back gives no time and v2 callbacks stay `unconfirmed`. *(Final, Ops ruling 21 Oct.)*
   **Complaint** and **escalation** receipts are confirmed when the backend write succeeds, with no read-back. Old-path escalations have no row id, and that is fine (`writtenRowId` is required only for booking / order / quote). A v1 "soft" escalation (desk note only) is unconfirmed. *(Final.)*
3. **Price and stock come only from catalogue facts.** Stock is `in_stock`/`out_of_stock` only when the catalogue row says so. A null or empty `in_stock` is `unconfirmed` (HD_8a8aa14db292). `catalogueId` is the catalogue row's real id or `null`; synthetic ids (`name:<slug>`, `prd_<n>`) are never emitted. `null` means off-catalogue (no `unitPrice`, `unconfirmed` stock) or a matched catalogue row that has no id (price and stock still come from that row). *(Final, Ops ruling 21 Oct.)*
4. Missing slot means `{ status: 'not_given' }` with no value. Values are never guessed.
5. Outcome precedence: missed (never answered) > escalated > booked (confirmed) > ordered (confirmed) > callback_needed (any callback/complaint receipt, or a confirmed quote) > abandoned (answered, **no receipt and nothing answered**) > info_only. **Unconfirmed receipts never upgrade the outcome**, except that any callback or complaint receipt (confirmed or not) gives `callback_needed`. Interest with no confirmed write is `info_only` plus an unconfirmed receipt.
6. `missed` and `abandoned` carry no receipts. `urgent === (an escalation receipt exists)`.
7. BA v2 handoffs: **only a manager request is urgent** (`escalation` receipt, outcome `escalated`). The ladder, address and payment handoffs are `callback` receipts and a complaint is a `complaint` receipt; all of these give outcome `callback_needed`, never urgent. *(Final, Ops ruling 21 Oct.)*
8. Never-answered calls: Brain emits no typed `missed` event on v1 (no brain state exists). **Ops' 2-min fallback covers them** ("Missed call from X"). Retiring the mid-call owner SMS/WhatsApp sends is **Ops' job**; Brain does not touch them. *(Final, Ops ruling 21 Oct.)*

## Ops sender notes (Ops owns; restated for alignment)

- Confirmed receipts render as an order/booking. Unconfirmed ones render as "Interested in X, not confirmed".
- Stock is shown only when `in_stock` or `out_of_stock`. `unconfirmed` shows "stock to confirm". Price is shown as a range from `unitPrice` (`min`–`max` per `unit`; a single price when min = max).
- `callLanguage` picks the EN/SW template. Missing slots show "not given". `caller.phone: null` shows "number not captured".
- A 30 s settle after call end, unless `urgent` (send now, still once per call). Dedup on `(callId, channel)` server-side. Channel order: WhatsApp if the 24 h window is open, then SMS, then email.
- 2-min fallback with no event, worded by outcome: missed gets "Missed call from X", answered gets "Call from X, no details captured".
- Only `missed` may be labelled "missed-call lead".

## Ops rulings (21 Oct, final)

| # | Topic | Final |
|---|---|---|
| 1 | Caller field | `caller.phone` only, holding the E.164 value; no other phone key. |
| 3 | Confirmation | Callback: number + time read back, explicit yes (repeated time counts; "okay wait" does not) and a successful write, else `unconfirmed`; still `callback_needed`, non-urgent. Complaint / escalation: confirmed on a successful write; old-path escalations without a row id are fine. Booking / order / quote: read-back + yes + `writtenRowId`. |
| 4 | Never-answered calls | Covered by Ops' 2-min fallback; no Brain event. |
| 5 | Mid-call SMS | Retiring them is Ops' job. |
| 7 | v2 handoffs | Only a manager request is urgent; other handoffs are `callback_needed`. |
| 2 | Event name field | Top-level `event: 'call.summary.ready'` stays. |
| 6 | `catalogueId` | The real catalogue id or `null`; no synthetic ids. |
| 8 | Null phone | `caller.phone` may be `null`; the sender shows "number not captured". |

No open items remain.

## Proposed durable outbox (NOT applied; Platform to review)

```sql
-- docs/supabase/call_summary_events.sql (proposal only)
create table if not exists public.call_summary_events (
  call_id uuid primary key references public.calls(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id),
  schema_version smallint not null default 1,
  outcome text not null,
  urgent boolean not null default false,
  payload jsonb not null,
  emitted_at timestamptz not null default now(),
  replaced_count integer not null default 0,
  sent_at timestamptz            -- set by the Ops sender; a re-emit never clears it
);
alter table public.call_summary_events enable row level security;
-- service role only; owners read via calls.summary.call_summary_event
```
