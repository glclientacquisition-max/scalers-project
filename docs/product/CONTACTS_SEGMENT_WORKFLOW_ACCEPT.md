# Contacts segment + click-through — Product ACCEPT

**Date:** 2026-09-21  
**Status:** ACCEPT — founder ask (parallel polish)  
**Ladder:** Desk polish only. Not Funnel Page. Not WA Cloud. Not ticket-chat follow-ups (shipping). Contacts Phase 1 + strip remain closed as shipped.

## Product lock (binding, 2026-09-21)

- Contacts segments use the shared **`FilterTabs`** chrome family as Inbox **List/Work** and **Today/Week**: underline, `min-h-11`, scroll, count chip style (`filterTabClass`).
- Do **not** copy Inbox purpose pills (`InboxFilterPills`: Needs you / Visits / Holds / …). Those stay Inbox-only.
- Contacts segments: **All · Saved · Unsaved** only. No Recent tab. Sort if present stays the same FilterTabs family (Last call · Name).
- Critic: PASS if chrome-only. Hard bans: no Online, last seen, or presence; Call/WA opened never delivered; no `lead_status` invent.

---

## Map (today)

| Surface | Behavior |
| --- | --- |
| **Inbox** | Purpose piles are `InboxFilterPills` (Needs you / All / Visits / Holds / …). **List/Work** and **Today/Week** are underline `FilterTabs`. |
| **Contacts** | Same `FilterTabs` chrome as Inbox List/Work: **All · Saved · Unsaved** (`saved=` query). `aria-label` Filter contacts. List → `/contacts/[id]` profile. Call/WA on rows = **opened** only. |
| **Gap founder feels** | Contacts segments must feel identical to Inbox List/Work tabs (one desk pattern), not purpose pills and not a one-off slider. Click-through must be a clear ops path, not a dead end. |

Phase 1 ACCEPT already required search+sort and Recent/Unsaved quick rows. This brief locks **FilterTabs pattern parity with Inbox List/Work** and documents click-through. Recent is sort (Last call), not a segment.

## Problem

Contacts filtering and Inbox filtering don’t read as one desk language. Opening a contact must land on a predictable workflow (who → Call/WA/name → back) without Online theater or delivery lies.

## Operator outcome

Owner switches Contacts piles the same way they switch Inbox List/Work tabs. Tapping a contact opens a clear phone-first profile with honest actions. Same composition family at ~390 / tablet / desktop.

## Acceptance

### A. One segment pattern (desk-wide)

1. Contacts filters use the **same `FilterTabs` chrome** as Inbox List/Work and Today/Week — underline/active, hit size, scroll, count chip style — not a bespoke slider skin and not `InboxFilterPills`.  
2. Contacts segment set: **All · Saved · Unsaved** only.  
3. Copy: aria/label plain (“Filter contacts”), no em dashes, no “last seen” / Online.  
4. Sort (Last call / Name) if present: same FilterTabs family; must not invent presence.

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
- Critic PASS if chrome-only. Re-gate if honesty labels move.

### D. Responsive

One composition family: ~390 / tablet / desktop. ≥44px hits. Release smoke all three.

## Out of scope

- Tenant Funnel Page, shop WA Cloud connect  
- Ticket chat follow-ups (#384 follow-ups already shipping)  
- Merge duplicates, Meta presence, CSV import redesign  
- New lead_status / notify channels  
- Rebuilding Inbox purpose model  
- Copying Inbox purpose pills onto Contacts  

## Seat

| Who | Does |
| --- | --- |
| Desk UX | Segment parity + click-through polish + PR |
| Desk Builder | Only if contact query/sort/handlers missing |
| Critic | PASS if chrome-only. Re-gate if honesty copy/chips move |
| Release | Smoke 390 / tablet / desktop |

## Kill / rollback

If Contacts gets a second segment skin, Inbox purpose pills, Online/last-seen, or WA claimed delivered → revert. Prefer revert over dual patterns.

## Verify (TEST)

Contacts FilterTabs match Inbox List/Work chrome → switch All/Saved/Unsaved → open contact → Call/WA opened only → Name this caller works → back keeps segment → check three widths. No Needs you / Visits / Holds pills on Contacts.

