# Contacts person file. Product ACCEPT

**Date:** 2026-09-21  
**Status:** ACCEPT. Founder / Critic honesty gate (phone-first Kenyan SME ops)  
**Ladder:** Desk polish only. Not Funnel. Not WA Cloud. Not VIP / Lead / Cold piles. Not SEGMENT slots. Extends Phase 1 + segment FilterTabs + ops workflow (`CONTACTS_LIST_PHASE1_ACCEPT.md`, `CONTACTS_SEGMENT_WORKFLOW_ACCEPT.md`, `CONTACTS_OPS_WORKFLOW_ACCEPT.md`).  
**Ladder vocab:** [`DELIVERY_VOCAB.md`](DELIVERY_VOCAB.md) (`opened` only for Call / WhatsApp).

---

## Problem

The person file already has a Timeline of raw call / request / visit rows, but stamps invent CRM nouns (Call, Request) instead of Inbox states. There is no honest KPI strip. Owners need History plus sourced facts at ~390 and desktop without wallpaper numbers.

## Operator outcome

Owner opens `/contacts/[id]`, sees History built from that contact's real tickets and calls, taps a row into the existing ticket/call route, and reads KPI cards only when the source exists.

## Acceptance (must ship)

1. **History** on the person file. Rows from real tickets/calls for that contact only. One Inbox ticket per call (job or hold attached to that call does not duplicate the call). Labels map to existing Inbox states only (Visit / Visit done / Hold / Human asked / Missed / Answered / Live). Invent no CRM labels (no Call / Request type column). Tap-through uses existing ticket/call routes (`inboxRecordHref` / `/calls/[id]`) when a `callId` exists. No invented outcomes. No tap when there is no ticket/call route.
2. **KPI strip.** Show each card only when its source exists; omit/hide if unknown or empty. Locked derivations:
   - **Interactions** = count of real assembled call/ticket rows for that contact. Hide when 0.
   - **Visits done** = jobs with status `done` (confirmed completed visits) for that contact. Hide when 0.
   - **Customer since** = earliest stored first-seen / first call / contact `created_at`. Show relative months from that stamp (`N mo`). Hide when no stamp.
3. **Contacts list nouns** stay **All · Saved · Unsaved** from #386. Chrome for those piles is the Inbox purpose pill-chip (`InboxFilterPills`) per `CONTACTS_CHROME_PILL_ACCEPT.md`. Do **not** put Inbox purpose nouns (Needs you / Visits / Holds / Human / Answered) on Contacts.
4. **Call / WhatsApp** actions: opened-only honesty (`tel:` / `wa.me`). Top icons only on the person file. No labeled Call / WhatsApp pills.
5. Phone-first density at ~390 plus desktop. Match existing desk chrome / FRONTEND_CONSTITUTION / design system. No glass, no KPI wallpaper, no fake Online.

## KEEP

- Phone locked
- Notes editable
- Name this caller / Name + Save
- Inbox threads link-back
- All · Saved · Unsaved nouns + sort Last call · Name
- Call / WA opened-only on list + person-file top icons

## DEFER (do not ship)

- Repeat piles
- Funnel
- Free SEGMENT slots / tags UI
- VIP / Lead / Cold list piles
- Inventing or extending `lead_status`
- Online / last-seen / delivered theater
- Inbox purpose nouns on Contacts filters
- Unsourced KPI wallpaper (mock numbers)

## KILL

- Dual History skins
- Taxonomy chips that say Job / Hold as Brain ids
- Presence dots, last seen, active now
- Delivered / sent WhatsApp claims from the person file

## Seat / walls

Desk UX chrome only. Do not change `lead_status` / notify / wallet semantics. Builder only if a real handler is missing. Reuse Inbox assemble + signal labels. No new status enums. If a KPI source does not exist in schema, hide that card.

## Verify (TEST)

lint + build green for dashboard. History shows real rows only; tap opens a real ticket/call. KPI cards present only when derived; formulas match lock. List still All · Saved · Unsaved. Call / WA unchanged honesty. Smoke 390 + desktop.
