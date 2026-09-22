# Contact strip — Product ACCEPT

**Date:** 2026-09-21  
**Status:** ACCEPT — founder unlock after Contacts Phase 1 #382 Release GO  
**Ladder:** Parallel desk polish. Does **not** jump Tenant Funnel Page (still next major after honesty K1–K4 + notify hygiene).

---

## Problem

On a ticket / person surface, the owner still hunts for who this is. Phase 1 shipped the dense Contacts list; the ticket still needs a compact identity strip so triage stays on the call. Call and WhatsApp belong once, on the ticket dock.

## Operator outcome

On call/ticket (and matching person surfaces), a compact **contact strip** shows who + one honest fact, without opening the full profile for the common path. Call / WhatsApp sit on the ticket action dock. Same composition family as Phase 1 list (~390 / tablet / desktop).

## Acceptance

1. **Strip content:** avatar · display name (or Unsaved / Name this caller affordance) · **one** factual subline only: last call · Unsaved · phone.  
2. **Actions:** Strip is identity. Call + WhatsApp live on the ticket action dock when a phone exists; targets ≥44px; safe-area aware.  
3. **Honesty (Critic):** Call/WA = **opened** on `tel:` / `wa.me`. Ticket-dock WhatsApp may write follow-up. Never sent/delivered without channel evidence. No Online, last seen, presence dots, or active now. No new `lead_status` / Needs you / notify invent. No Meta activity theater.
4. **Profile:** Tap identity opens existing #362 profile dock; Name this caller unchanged.  
5. **Responsive:** One composition family at ~390 phone, tablet, desktop — not a second layout language.  
6. **Scope of surfaces:** Call/ticket detail required; other person surfaces only if already in the same chrome family (no drive-by redesign).  
7. Release smoke at all three widths; Critic PASS on honesty copy.

## Out of scope

- Contacts list Phase 1 redo (#382 closed)  
- Merge duplicates, Meta presence, fake Online  
- Tenant Funnel Page, Platform notify ledger, Meta Cloud send  
- New lead_status / Needs you / notify channels  
- Inbox verb / bookings honesty reopen  

## Seat

| Who | Does |
| --- | --- |
| Desk UX | Placement + strip chrome + PR |
| Desk Builder | Only if Call/WA / name handlers missing on ticket |
| Critic | Honesty of subline + opened-not-delivered |
| Release | Smoke 390 / tablet / desktop |

## Critic PASS (hard bans)

Bind on the strip. Kill the PR if any line fails.

- No Online, last seen, presence dots, or active now.
- Strip lines factual only: Unsaved, phone, last call. Never delivered or sent without channel evidence. Cite [`DELIVERY_VOCAB.md`](./DELIVERY_VOCAB.md).
- No inventing `lead_status` or Needs you from the strip.
- No Meta activity theater (ticks, last seen, typing, presence).
- Call / WhatsApp live on the ticket dock (`tel:` / `wa.me`). Strip does not duplicate them.
- One family at ~390, tablet, and desktop.

## Kill / rollback

If strip shows Online/last-seen, claims WA delivered, invents status, or ships a second visual language → revert PR. Prefer revert over patching lies.

## Verify (TEST)

Open Needs you ticket with phone → strip shows name + factual subline → dock shows Call/WA → WA does not claim delivered → identity opens #362 dock → check 390, tablet, desktop same family.
