---
owner: brain
last_reviewed: 2026-10-21
---

# `call.summary.ready` — contract v1 (A4: one owner summary per call)

Agreed Brain ⇄ Ops, 21 Oct 2026. Alvin approved A4 (Chief, 10:37 EAT) and Brain's build (11:44 EAT).
Brain owns outcome, receipts, slots and the emitter. Ops owns the sender, dedup, channel, settle, billing and fallback
(`/workspace/briefs/a4-owner-summary-sender-spec.md`).

Code: `src/conversation/callSummaryEvent.js` (pure builder, validator, v1 receipts, emitter),
`src/conversation/v2/summaryReceipts.js` (BA v2 branch only; v2 receipts, from `v2/machine.js` `finishCall`). Flag `CALL_SUMMARY_EVENT`, **off by default**.

## Emission

- Event name `call.summary.ready`, emitted **once per call at call end** from the hangup summary write
  (`writeHangupSummary` → `emitHangupCallSummary` in `server.js`, inside the run-once finalizer). Both paths: v1 always;
  v2 when the BA v2 live runner took at least one turn (`finishCall(state, { profile })` → `summaryReceipts`).
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
  event: 'call.summary.ready',
  schemaVersion: 1,
  path: 'v1' | 'v2',
  callLanguage: 'en' | 'sw',
  callId,            // calls.id (uuid); falls back to the call sid if the row is missing
  tenantId,
  outcome: 'booked' | 'ordered' | 'callback_needed' | 'info_only' | 'abandoned' | 'missed' | 'escalated',
  urgent: boolean,   // true ONLY if an escalation receipt exists
  caller: { name?, phone },        // phone = E.164 (+2547…), or null if not normalisable; no other keys
  receipts: [{
    receiptId,
    type: 'booking' | 'order' | 'callback' | 'quote' | 'complaint' | 'escalation',
    status: 'confirmed' | 'unconfirmed',
    writtenRowId?,   // appointments.id / service_requests.id actually written
    slots: { <name>: { value?, status: 'given' | 'not_given' } },
    items?: [{ catalogueId, name, qty: { value?, status }, unitPrice?: { min, max, unit }, stock: 'in_stock' | 'out_of_stock' | 'unconfirmed' }]
  }],
  escalationReason?, // present iff an escalation receipt exists
  emittedAt          // ISO 8601 (UTC)
}
```

Slots used: booking `service, when, place, name`; order `pickup, name` plus `items`; callback/quote/complaint/escalation `reason, name`.

## Rules (enforced by `validateCallSummaryEvent`)

1. **Confirmed** booking / order / quote = a read-back, then an explicit, whole-answer yes, **and** a row written (`writtenRowId`). *(Final, Ops ruling 21 Oct.)*
   - v2: commits only run on the redeemed `confirm_token`, and a row id must come back.
   - v1: the transcript needs an agent read-back cue followed directly by a whole-answer yes. "Okay wait…", "Sawa lakini…?" and "Yes but make it three" are not yes.
   - A written row with no read-back stays `unconfirmed` (HD_e75a669780d4).
2. callback / complaint / escalation are confirmed when the backend write succeeds, with **no read-back needed** (the caller's own ask or report). Old-path escalations have no row id, and that is fine: `writtenRowId` is optional for these types. A v1 "soft" escalation (desk note only) is unconfirmed. *(Final, Ops ruling 21 Oct.)*
3. **Price and stock come only from catalogue facts.** Stock is `in_stock`/`out_of_stock` only when the catalogue row says so. A null or empty `in_stock` is `unconfirmed` (HD_8a8aa14db292). An off-catalogue item has `catalogueId: null`, no `unitPrice` and `unconfirmed` stock.
4. Missing slot means `{ status: 'not_given' }` with no value. Values are never guessed.
5. Outcome precedence: missed (never answered) > escalated > booked (confirmed) > ordered (confirmed) > callback_needed (any callback/complaint receipt, or a confirmed quote) > abandoned (answered, **no receipt and nothing answered**) > info_only. **Unconfirmed receipts never upgrade the outcome.** Interest with no confirmed write is `info_only` plus an unconfirmed receipt.
6. `missed` and `abandoned` carry no receipts. `urgent === (an escalation receipt exists)`.
7. BA v2 handoffs: **only a manager request is urgent** (`escalation` receipt, outcome `escalated`). The ladder, address and payment handoffs are `callback` receipts and a complaint is a `complaint` receipt; all of these give outcome `callback_needed`, never urgent. *(Final, Ops ruling 21 Oct.)*
8. Never-answered calls: Brain emits no typed `missed` event on v1 (no brain state exists). **Ops' 2-min fallback covers them** ("Missed call from X"). Retiring the mid-call owner SMS/WhatsApp sends is **Ops' job**; Brain does not touch them. *(Final, Ops ruling 21 Oct.)*

## Ops sender notes (Ops owns; restated for alignment)

- Confirmed receipts render as an order/booking. Unconfirmed ones render as "Interested in X, not confirmed".
- Stock is shown only when `in_stock` or `out_of_stock`. `unconfirmed` shows "stock to confirm". Price is shown as a range from `unitPrice` (`min`–`max` per `unit`; a single price when min = max).
- `callLanguage` picks the EN/SW template. Missing slots show "not given".
- A 30 s settle after call end, unless `urgent` (send now, still once per call). Dedup on `(callId, channel)` server-side. Channel order: WhatsApp if the 24 h window is open, then SMS, then email.
- 2-min fallback with no event, worded by outcome: missed gets "Missed call from X", answered gets "Call from X, no details captured".
- Only `missed` may be labelled "missed-call lead".

## Ops rulings (21 Oct, final)

| # | Topic | Final |
|---|---|---|
| 1 | Caller field | `caller.phone` only, holding the E.164 value; no other phone key. |
| 3 | Confirmation without read-back | callback / complaint / escalation are confirmed on backend write success; booking / order / quote still need read-back + yes + `writtenRowId`; old-path escalations without a row id are fine. |
| 4 | Never-answered calls | Covered by Ops' 2-min fallback; no Brain event. |
| 5 | Mid-call SMS | Retiring them is Ops' job. |
| 7 | v2 handoffs | Only a manager request is urgent; other handoffs are `callback_needed`. |

Still open (not ruled, no change): #2, the emitter adds `event: 'call.summary.ready'`; #6, `catalogueId` is `null` off-catalogue and `name:<slug>` when the row has no id (treat as opaque).

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
