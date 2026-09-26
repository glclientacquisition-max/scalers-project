# Contacts chrome pill. Product ACCEPT

**Date:** 2026-09-21  
**Status:** ACCEPT. Founder chrome pass (parallel to #389 person-file honesty)  
**Ladder:** Desk polish only. Not Funnel. Not WA Cloud. Not VIP / Lead / Cold piles. Not SEGMENT slots. Not History / KPI formula changes. Extends Phase 1 + segment + ops + person file (`CONTACTS_LIST_PHASE1_ACCEPT.md`, `CONTACTS_SEGMENT_WORKFLOW_ACCEPT.md`, `CONTACTS_OPS_WORKFLOW_ACCEPT.md`, `CONTACTS_PERSON_FILE_ACCEPT.md`).  
**Ladder vocab:** [`DELIVERY_VOCAB.md`](DELIVERY_VOCAB.md) (`opened` only for Call / WhatsApp).

---

## Problem

Contacts list segments still use underline `FilterTabs`. Inbox purpose already uses filled pill chips. The person file shows Call and WhatsApp twice: top `deskHitClass` icons and a labeled dock that reads as large pills. Owners need one desk chip language and one reach control.

## Operator outcome

Owner switches All / Recents / Favourites / Saved / Unsaved on Contacts with the same filled-pill chrome as Inbox purpose. Opening a person file shows Call and WhatsApp once, as top icons. Honesty is unchanged.

## Acceptance (must ship)

1. **Contacts list filters.** One `InboxFilterPills` row. Nouns: **All · Recents · Favourites · Saved · Unsaved**. Recents and Favourites live on that row. Unsaved once. Same pill DESIGN as Inbox purpose. Count badge only when a real count is already on the page load. Do not copy Inbox purpose nouns (Needs you / Visits / Holds / Human / Answered) onto Contacts. Do not add a second chip strip.
2. **Sort stays underline.** Last call · Name remains the second `FilterTabs` row (`aria-label` Sort contacts). Same family as Inbox List / Work.
3. **Person file header.** Keep top Call and WhatsApp icons (`CallLink` `tel:` + `WhatsAppLink` `wa.me`, `deskHitClass`). Remove the large labeled Call / WhatsApp pills. One reach row. Opened only. No write-back claims change.
4. **#389 honesty stays.** History stamps, tap-through, and sourced KPI cards are unchanged. Layout may shift only to dock the icons in the header.

## KEEP

- All · Recents · Favourites · Saved · Unsaved nouns on one row
- Sort Last call · Name as FilterTabs
- Phone locked
- Notes editable
- Name this caller / Name + Save
- Inbox threads link-back
- Call / WA opened-only (`tel:` / `wa.me`)
- Derived History + KPI strip from #389

## DEFER (do not ship)

- Funnel
- Free SEGMENT slots / tags UI
- VIP / Lead / Cold list piles
- Inventing or extending `lead_status`
- Inbox purpose nouns on Contacts
- Fake Online / last-seen / delivered theater
- New count queries just to fill badges

## KILL

- Dual Call / WhatsApp on the person file (icons plus labeled pills)
- A second Contacts filter skin
- Underline FilterTabs for Contacts segments
- A second Recents / Favourites / Unsaved strip above the filters

## Seat / walls

Desk UX chrome only. Do not change `lead_status` / notify / wallet semantics. Reuse `InboxFilterPills` for the chip look. Do not invent a second pill component. No glass. No em dashes in owner-facing copy.

## Verify (TEST)

lint + build green for dashboard. List chips: All · Recents · Favourites · Saved · Unsaved on one filled-pill row, no Needs you / Visits / Holds. Sort still Last call · Name. Person file: top Call / WA icons only; large pills gone. History and KPI formulas untouched. Call / WA still `tel:` / `wa.me`. Smoke 390 + desktop.
