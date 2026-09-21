# Contacts ops workflow — Product ACCEPT

**Date:** 2026-09-21  
**Status:** ACCEPT — founder deep pass (Contacts UX sync)  
**Ladder:** Desk polish only. Not Funnel. Not WA Cloud. Not notify/lead_status. Extends Phase 1 + segment FilterTabs (`CONTACTS_LIST_PHASE1_ACCEPT.md`, `CONTACTS_SEGMENT_WORKFLOW_ACCEPT.md`).  
**Ladder vocab:** [`DELIVERY_VOCAB.md`](DELIVERY_VOCAB.md) (`opened` only for Call / WhatsApp).

---

## Problem

Contacts lead row is crowded (Import CSV + From this phone + Add contact as three separate CTAs). Rename only appears for junk/unsaved names. Profile has timeline to call but no clear Contact to Inbox threads entry. Phone-first 390 density suffers from the crowded lead.

## Operator outcome

Owner adds contacts from one Add control, can rename a saved contact, jumps from a person file into Inbox threads for that caller, and the Contacts lead row is thumb-friendly at ~390.

## Acceptance (must ship)

1. **One Add control** on `/contacts` that opens options: New (manual AddContactPanel flow) · CSV (navigate to `/contacts/import`) · From this phone (existing PhonebookImportButton / Contact Picker path when available; hide phonebook option when picker unavailable). Remove the three separate lead CTAs. Prefer a single primary Add that reveals the three options. Match existing DeskDialog / settings chrome. No new visual language.
2. **Rename when name already saved** on `/contacts/[id]` for saved/named contacts, not only `isJunkCallerName` / Name this caller. Reuse `updateContactName` / ContactNameForm. Honest labels: plain Name / Save, no Online. Phone stays locked. Notes keep as today.
3. **Contact to Inbox threads link-back** on the person profile. One clear control that takes the owner to Inbox scoped to this caller's threads via existing inbox href helpers / search by phone. Do not invent lead_status or a parallel pile. If no honest handler exists, stop. Do not fake a dead link.
4. **390 density.** Cut crowded lead CTAs via (1). Hits ≥44px. Safe area. One composition family phone / tablet / desktop. No second segment skin.

## KEEP

- Phone locked
- Notes editable
- Call / WA opened-only (`tel:` / `wa.me`) on list + profile dock + strip
- FilterTabs All · Saved · Unsaved + sort Last call · Name + search + segment-preserving back (`contactProfileHref` / `contactsReturnHref`)

## DEFER (do not ship)

- Tags / extra CRM fields
- AI-from-comms enrichment / inventing facts from transcripts as profile fields

## KILL

- Funnel work, Online / last-seen / presence, delivered/sent WhatsApp claims, invent lead_status / Needs you / notify channels

## Seat / walls

Desk UX chrome only. Do not change lead_status / notify / wallet semantics. Builder only if a real handler is missing. Match existing desk chrome (FilterTabs, DeskDialog, CallLink, WhatsAppLink, DeskBack). No glass, KPI wallpaper, fake Online. No em dashes in owner-facing copy.

## Handler used (Inbox threads)

`inboxThreadsFromContactHref(phone)` → `inboxReturnHref({ purpose: "all", q: phone })`. Existing Inbox search (`itemMatchesQuery` includes `callerPhone`). `purpose=all` so default Needs you pile does not hide other threads for that caller. No phone: no control.

## Out of scope

- Tenant Funnel Page, shop WA Cloud connect
- Tags, CRM fields, transcript-invented profile facts
- lead_status / Needs you / notify invent
- Rebuild of Inbox purpose model or Contacts FilterTabs segments

## Verify (TEST)

lint + build green for dashboard. Manual: 390 / tablet / desktop. Add menu, rename saved name, Inbox threads entry, lead row uncrowded. Call / WA still opened-only.
