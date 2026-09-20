# Inbox verb cut Phase 1 (P0)

**Status:** Shipping in this PR.  
**Lane:** Desk UI/UX  
**Date:** 2026-09-20  
**Authority:** [`FRONTEND_CONSTITUTION.md`](../frontend/FRONTEND_CONSTITUTION.md) and [`calls.md`](../frontend/design-system/pages/calls.md) outrank this spec.  
**Depends on:** [`inbox-verb-simplification.md`](./inbox-verb-simplification.md) (owner cut 2026-09-18, shipped #331).  
**Do not regress:** #364 list dock recipe, #369 Needs you next-step line.  
**Evidence:** `tests/inboxVerbWorkflow.test.js`, `tests/inboxRowOverflow.test.js`, `tests/inboxBulkSelect.test.js`, `tests/inboxTriage.test.js`.

Phase 1 is Desk only. Remove Snooze and Mark unread / Mark read from owner surfaces. Add a real Unarchive. Keep the SQL columns.

---

## Verdict

Overflow, ticket ⋮, bulk, and phone select no longer expose Snooze or Mark unread / Mark read.

The phone More sheet that existed only to park those two verbs is gone. List More is `hidden md:inline-flex`. Long-press enters the header select bar. There is no empty More for them.

Archived pile overflow and archived ticket ⋮ offer **Unarchive** (`lead_status = new`). They do not offer Mark done or Archive.

`inbox_read_at` and `inbox_snoozed_until` stay on `calls`. Server writers stay in `inboxTriageActions.ts`. The owner facade (`inboxLeadActions.ts`) no longer wraps snooze or toggle-read.

Dock and #369 stay the same functions: `inboxListDockRecipe` and `inboxNeedsYouNextStep` in `InboxItemRow`.

---

## Surfaces

| Surface | Verbs | Not here |
| --- | --- | --- |
| md+ overflow / right-click | Pin / Unpin. Mark done when `inboxCanMarkDone`. Archive, or Unarchive when archived. Hairline before leave. | Select. Snooze. Mark unread / Mark read. Mute. Assign. Label. Delete. Confirm. Hold Done. Call. WhatsApp. |
| Phone list | Long-press 500ms enters select. Dock stays Confirm, hold Done, or Call plus WhatsApp. | More sheet. Snooze. Unread. |
| Header select / desktop bulk | Close, count, then only verbs true for every selected row. Archive if none archived. Unarchive if all archived. Confirm / Hold Done / Mark done when every row shares that action. | More sheet. Pin. Snooze. Unread. Mixed archive selection can show only Close. |
| Ticket ⋮ | Archive, or Unarchive when archived. Portaled, 44px rows. | Pin. Mark done (dock). Snooze. Unread. |
| Ticket dock | Mark done when `inboxTicketCanMarkDone`. Call. WhatsApp. Ping when not archived. | Archive. Unarchive. Snooze. Unread. |
| Archived pile row | Pin plus Unarchive on md+ overflow. Call plus WhatsApp if a number. | Mark done. Archive. Confirm. Hold Done. |

Bulk Mark done writes `lead_status = resolved` and leaves the row on screen. It does not `patch hidden`. Overflow Mark done is the same. Only Archive and Unarchive hide locally.

---

## Columns

Keep:

- `calls.inbox_read_at` (ticket open still stamps via `inboxMarkSeen`; no Unread pile)
- `calls.inbox_snoozed_until` (`itemIsSnoozed` still drops due rows in `assembleInboxItems`)

Do not drop SQL. Platform owns any later drop.

---

## Out of scope

- New piles (Unread, Snoozed)
- Auto-read changes
- LeadStatusToggle cut
- Contact strip
- Platform schema work
- New `lead_status` or notify semantics
- Changing Confirm, hold Done, Call, WhatsApp, or `inboxNeedsYouNextStep`

---

## Phone and desktop

One composition. Phone (~390px) uses `InboxPhoneRow`. `md+` uses `InboxTableRow`. Hits stay `deskHitClass` / `btnDock`. List More is desktop-only. Ticket ⋮ stays on both widths because it is Archive or Unarchive, not an empty sheet.

---

## Test gate

- Overflow, ticket, and bulk have no Snooze or Mark unread / Mark read.
- Phone select has no More sheet.
- Archived overflow and ticket offer Unarchive, not Mark done or Archive.
- Bulk Mark done does not `patch hidden`.
- `inboxLeadActions` has no `inboxToggleRead` / `inboxSnooze`. Writers and SQL columns remain.
- `InboxItemRow` still calls `inboxListDockRecipe` and `inboxNeedsYouNextStep`.
- Dashboard lint / build.
