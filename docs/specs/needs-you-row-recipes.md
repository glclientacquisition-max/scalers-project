# Needs you row recipes

**Status:** Shipping in this PR.  
**Lane:** Desk UI/UX  
**Date:** 2026-09-20  
**Authority:** [`FRONTEND_CONSTITUTION.md`](../frontend/FRONTEND_CONSTITUTION.md) and [`calls.md`](../frontend/design-system/pages/calls.md) outrank this spec.  
**Evidence:** `tests/inboxNeedsYouRowRecipes.test.js` plus `inboxListDockRecipe` in `inboxListVerbs.ts`.

This spec answers one decision: on Inbox **Needs you**, each row kind gets one honest primary verb. Placement and visibility only. No new `lead_status` values. No new notify channels.

Call-detail dock (#360) is already shipped. This PR does not redo it.

---

## Verdict

On Needs you, the trailing Action dock is:

| Row kind | When | Primary verb |
| --- | --- | --- |
| **Visit** | Appointments row, `status = requested` | **Confirm** |
| **Hold** | Service request row, `status = open` | **Done** |
| **Return** | Human asked or missed, dialable number | **Call** then **WhatsApp** |
| **Intent-only** | Job purpose with no appointments row, or hold purpose with no request row | No Confirm. No Done. Call then WhatsApp if a number exists. Empty if not. |

Stamp still matches that verb. Confirm visit only when an appointments row exists. Intent-only visits stamp Visit not booked (hospitality: Booking not booked). Intent-only holds stamp Hold not saved.

---

## What is reused

Handlers already shipped in #358 / #360 stay the source of truth:

| Verb | Handler | Component |
| --- | --- | --- |
| Confirm | `inboxConfirm` → `updateAppointmentStatus` | `InboxJobActions` |
| Hold Done | `inboxHoldDone` → `updateServiceRequestStatus` | `RequestStatusToggle` |
| Call | `tel:` | `CallLink` |
| WhatsApp | `wa.me` plus existing follow-up write-back | `WhatsAppLink` |
| Eligibility | `inboxCanConfirm`, `inboxCanHoldDone` | `inboxListVerbs.ts` |

The list dock now asks `inboxListDockRecipe(item)` before mounting those same controls. It does not add a parallel Confirm or Done path.

---

## What changed

`InboxTrailingAction` used to mount `InboxJobActions` whenever `item.job` existed, and `RequestStatusToggle` whenever `item.hold` existed. That leaked Reopen and Done badges onto rows with no honest list verb, and it could look like Confirm or Done on intent-only work if a leftover row was attached.

The recipe is the visibility gate:

1. Archived with a number: Call then WhatsApp. Never Confirm or hold Done.
2. `inboxCanConfirm`: Confirm.
3. Confirmed appointment (Visits List / All, not Needs you): visit Done. Confirmed visits have already left Needs you.
4. `inboxCanHoldDone`: hold Done.
5. Else a dialable number: Call then WhatsApp. Covers return calls and intent-only work.
6. Else empty.

Reopen stays on the call, never beside Done on the list.

---

## Out of scope

- Broader Inbox verb cut (overflow, bulk, Snooze, Unread)
- Voice transfer
- TEST data wipe
- Redoing the call-detail action dock
- New notify channels or `lead_status` rules
- Changing `inboxNeedsYou` pile membership

---

## Phone and desktop

One composition. Phone (~390px) uses `InboxPhoneRow`. `md+` uses `InboxTableRow`. The same recipe feeds both. Hits stay `deskHitClass` / `btnDock` (`h-12 w-12`). Confirm is the filled primary. Call and WhatsApp stay muted icon hits.

---

## Test gate

- Visit requested → `confirm`. Hold open → `hold_done`. Human / missed with number → `call_wa`.
- Intent-only visit or hold → never `confirm` or `hold_done`.
- Intent-only with no number → `none`.
- Archived → never Confirm or hold Done.
- `InboxTrailingAction` mounts handlers only through `inboxListDockRecipe`.
- Dashboard lint / build.
