# Contact strip — Product ACCEPT

**Date:** 2026-09-21  
**Status:** ACCEPT — founder unlock after Contacts Phase 1 #382 Release GO  
**Ladder:** Parallel desk polish. Does **not** jump Tenant Funnel Page (still next major after honesty K1–K4 + notify hygiene).

---

## Problem

On a ticket / person surface, the owner still hunts for who this is and how to Call or WhatsApp. Phase 1 shipped the dense Contacts list; the ticket still needs a compact identity strip so triage stays on the call.

## Operator outcome

On call/ticket (and matching person surfaces), a compact **contact strip** shows who + one honest fact + Call / WhatsApp when a number exists — without opening the full profile for the common path. Same composition family as Phase 1 list (~390 / tablet / desktop).

## Acceptance

1. **Strip content:** avatar · display name (or Unsaved / Name this caller affordance) · **one** factual subline only: last call · Unsaved · phone.  
2. **Actions:** Call + WhatsApp when phone exists; targets ≥44px; safe-area aware.  
3. **Honesty (Critic):** Call/WA = **opened** only — never sent/delivered. No Online, last seen, presence dots, “active now.” No new `lead_status` / Needs you / notify invent.  
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

## Kill / rollback

If strip shows Online/last-seen, claims WA delivered, invents status, or ships a second visual language → revert PR. Prefer revert over patching lies.

## Verify (TEST)

Open Needs you ticket with phone → strip shows name + factual subline + Call/WA → WA does not claim delivered → identity opens #362 dock → check 390, tablet, desktop same family.
