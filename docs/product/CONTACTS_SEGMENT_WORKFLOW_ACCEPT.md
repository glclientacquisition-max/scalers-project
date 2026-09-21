# Contacts segment + click-through — Product ACCEPT

**Date:** 2026-09-21  
**Status:** ACCEPT — founder ask (parallel polish)  
**Ladder:** Desk polish only. Not Funnel Page. Not WA Cloud. Not ticket-chat follow-ups (shipping). Contacts Phase 1 + strip remain closed as shipped.

---

## Map (today)

| Surface | Behavior |
| --- | --- |
| **Inbox** | Shared `FilterTabs` segment chrome — purpose piles (Needs you / All / Visits / Holds / …) with counts; horizontal scroll on phone. |
| **Contacts** | Same `FilterTabs` component: **All · Saved · Unsaved** (`saved=` query). Label today: “Filter by name.” List → `/contacts/[id]` profile (#362 dock). Call/WA on rows = **opened** only. |
| **Gap founder feels** | Contacts segments / any Recent↔Name control must **feel identical** to Inbox segments (one desk pattern), not a one-off slider. Click-through must be a clear ops path, not a dead end. |

Phase 1 ACCEPT already required search+sort and Recent/Unsaved quick rows — this brief locks **pattern parity with Inbox** and documents click-through.

## Problem

Contacts filtering and Inbox filtering don’t read as one desk language. Opening a contact must land on a predictable workflow (who → Call/WA/name → back) without Online theater or delivery lies.

## Operator outcome

Owner switches Contacts piles the same way they switch Inbox piles. Tapping a contact opens a clear phone-first profile with honest actions. Same composition family at ~390 / tablet / desktop.

## Acceptance

### A. One segment pattern (desk-wide)

1. Contacts filters use the **same `FilterTabs` (or successor shared) chrome** as Inbox — underline/active, hit size, scroll, count chip style — not a bespoke slider skin.  
2. Contacts segment set for this slice: keep **All · Saved · Unsaved** unless UX proves a **Recent** pile is needed for parity with Phase 1 “Recent calls” quick row — if Recent is shipped, it is another FilterTabs item, not a second control type.  
3. Copy: aria/label plain (“Filter contacts”), no em dashes, no “last seen” / Online.  
4. Sort (last call / A–Z / Unsaved first) if present: one control family, documented in PR; must not invent presence.

### B. Click-through workflow

| Step | Must |
| --- | --- |
| List row tap | Opens `/contacts/[id]` (or existing profile route) |
| Profile | Name (or Name this caller), phone, last-call fact if known |
| Actions | Call + WhatsApp when number exists (**opened** only — never delivered/sent) |
| Edit / save name | Existing #362 Name this caller path |
| Ping | Only if already on profile recipe; else out of scope |
| Back | Clear return to Contacts list with segment preserved |

### C. Honesty

- No Online, last seen, presence dots, active now.  
- Call/WA = opened. No lead_status / Needs you / notify invent from Contacts.  
- Critic re-gate if honesty labels move.

### D. Responsive

One composition family: ~390 / tablet / desktop. ≥44px hits. Release smoke all three.

## Out of scope

- Tenant Funnel Page, shop WA Cloud connect  
- Ticket chat follow-ups (#384 follow-ups already shipping)  
- Merge duplicates, Meta presence, CSV import redesign  
- New lead_status / notify channels  
- Rebuilding Inbox purpose model  

## Seat

| Who | Does |
| --- | --- |
| Desk UX | Segment parity + click-through polish + PR |
| Desk Builder | Only if contact query/sort/handlers missing |
| Critic | If honesty copy/chips move |
| Release | Smoke 390 / tablet / desktop |

## Kill / rollback

If Contacts gets a second segment skin, Online/last-seen, or WA claimed delivered → revert. Prefer revert over dual patterns.

## Verify (TEST)

Contacts FilterTabs match Inbox chrome family → switch All/Saved/Unsaved → open contact → Call/WA opened only → Name this caller works → back keeps segment → check three widths.
