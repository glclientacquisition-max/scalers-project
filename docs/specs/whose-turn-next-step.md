# Whose turn / next-step on Needs you

**Status:** Shipping in this PR.  
**Lane:** Desk UI/UX  
**Date:** 2026-09-20  
**Authority:** [`FRONTEND_CONSTITUTION.md`](../frontend/FRONTEND_CONSTITUTION.md) and [`calls.md`](../frontend/design-system/pages/calls.md) outrank this spec.  
**Depends on:** [`needs-you-row-recipes.md`](./needs-you-row-recipes.md) (`inboxListDockRecipe`).  
**Evidence:** `tests/inboxWhoseTurnNextStep.test.js` plus `inboxNeedsYouNextStep` in `inboxListVerbs.ts`.

This spec answers one decision: on Inbox **Needs you** rows, show one plain next-step line under the preview. Language only. No new `lead_status`. No new pile. No new notify.

---

## Verdict

Needs you rows already have one honest dock verb (#364). The row did not say that verb in words on the phone, where the stamp chip is off the preview.

Add **one muted, truncated line** under Work. It restates the same `inboxListDockRecipe` gate. It is not a second button.

| Recipe | When | Line |
| --- | --- | --- |
| **confirm** | Requested appointments row | Niche Confirm stamp (`Confirm visit` / `Confirm booking`) |
| **hold_done** | Open service request row | `Hold Done` (existing bulk label) |
| **call_wa** | Return call, missed, human asked, or intent-only, with a number | `Call or WhatsApp` |
| **none** | No number | Omit the line |
| **live** | Call still on the line | Omit the line. Stamp stays Live. |

Intent-only visit or hold is `call_wa` or `none`. The line never uses Confirm or Done language for those rows.

Confirmed visits have already left Needs you. `visit_done` does not paint this line.

---

## What is reused

| Input | Source |
| --- | --- |
| Gate | `inboxListDockRecipe` |
| Needs you membership | `itemInNeedsYouPile` |
| Confirm copy | `nicheCopy(vertical).confirmStamp` |
| Hold copy | Bulk label `Hold Done` already in `inboxBulkActions` |
| Return / intent-only copy | The two dock verbs, in words |

No hangup `next`, Want, Done, or mood on the list. Those stay on `/calls/[id]`.

---

## What does not change

- Dock verbs and `InboxTrailingAction` mounting
- `inboxNeedsYou` pile membership
- `lead_status` writes
- Notify channels
- Contact strip, verb cut, meta delivery ladder, call-timeline bubble
- Online / PSTN invent

---

## Copy caution

This line is whose-turn in operator English: what you do next with the controls already on the row. It is not a new state machine.

Do not add Your turn, Waiting on caller, Awaiting confirm, or any turn-taking vocabulary. Those would read as a new `lead_status`. If a later ticket needs caller-vs-owner turn, send it to Critic with a real field. Do not invent one here.

---

## Phone and desktop

One composition. Phone (~390px) uses `InboxPhoneRow`. `lg+` uses `InboxTableRow`. The same `inboxNeedsYouNextStep` feeds both.

The line is `text-xs text-ink-soft` plus `deskPreviewClass`. Work stays the `text-sm` preview. Hits stay `deskHitClass` / `btnDock`. No glass. No KPI wallpaper.

---

## Test gate

- Requested visit → Confirm visit (hospitality: Confirm booking).
- Open hold → Hold Done.
- Human / missed / intent-only with a number → Call or WhatsApp.
- Intent-only never contains Confirm or Done.
- No number, live, archived, confirmed visit → no line.
- Row mounts the line through `inboxNeedsYouNextStep`. Dock still uses `inboxListDockRecipe` only.
- Dashboard lint / build.
