# Bookings + holds — honesty target (ACCEPT)

**Status:** Founder LOCKED 2026-09-20 · Product ACCEPT path  
**Authority:** This lock outranks exploratory maps. Company Brain wins on product facts when merged. `DELIVERY_VOCAB.md`, Needs you / whose-turn, #364 recipes stay.  
**Lane after ACCEPT:** Chief routes Desk UX → Builder → Release.  
**Staging:** TEST tenant — ignore badge volume; judge honesty of status + copy.

---

## Locked decisions (do not reopen without founder)

| ID | Lock |
| --- | --- |
| **A1** | Requested visit = **request only**. No capacity claim until **Confirm**. Caller language before Confirm: request logged / we’ll confirm — **never “booked.”** |
| **B1** | Same-hour visits allowed by default. One-at-a-time capacity = later tenant switch, not this wedge. |
| **C1** | No hold auto-expire now. Leftover holds stay loud on Needs you. `hold_duration` = later. |
| **D1** | **Confirm** always updates status. Caller SMS honesty is separate (`sent` / `failed` per delivery vocab). **Do not block Confirm on SMS failure.** |
| **Spines** | **Two only:** `appointments` (visits) + `service_requests` (holds). No booking table. No soft-hold invent. No fourth status machine. |

---

## States (existing spines only)

### Visits — `appointments`

| State | Owner truth | Caller truth |
| --- | --- | --- |
| `requested` | Needs Confirm. Not booked. | Request logged / we’ll confirm. Never “booked.” |
| `confirmed` | On the book. Confirm already done. | Confirmed only after status write succeeded. SMS may separately be sent/failed. |
| `done` / cancelled | Left Visits book per existing recipes. | — |

### Holds — `service_requests`

| State | Owner truth |
| --- | --- |
| `open` | Needs Hold Done. Stays loud. No auto-expire. |
| `fulfilled` / cancelled | Leaves Needs you / Holds per existing recipes. |

No parallel `booking_status`, soft-hold, or hospitality reservation state in this slice.

---

## Owner verbs (desk)

| Verb | Spine | Writes | Notes |
| --- | --- | --- | --- |
| **Confirm** | visit `requested` → `confirmed` | Appointment status always | SMS is best-effort; failure → show failed, do not roll back Confirm (D1) |
| **Hold Done** | hold `open` → `fulfilled` | Request status | Unchanged honesty |
| **When + Save** | visit or hold | **Must** write `when_text` **and** `window_start` / `window_end` together | Kill #3 |
| Mark done / Call / WhatsApp | return-call path only | Per #364 / delivery vocab | Do not use “booked” |

---

## Copy rules

**Caller (voice / tool save / hangup summary)**  
- While appointment is `requested`: **“Visit request saved — confirm on desk.”** (exact Product wording for hangup/tool path).  
- Never: “booked a visit,” “you’re booked,” “reservation confirmed,” while status ≠ `confirmed`.  
- After Confirm succeeds: confirmed language OK; if SMS fails, say notify failed — not “we couldn’t confirm.”

**Owner (desk)**  
- Needs you / whose-turn for `requested` visit → Confirm language (not “booked”).  
- Open hold → Hold Done language.  
- No hospitality **Confirm booking** control until reservations exist (kill #4).

**Notify** — use `docs/product/DELIVERY_VOCAB.md` only (`opened` / `followed up` / `sent` / `delivered` / `failed`). No soft-sent confirm.

---

## Honest agreement rule (kill #2)

`calls.resolution` / tool-save outcome **must not** claim a closed book when desk still needs Confirm or Hold Done.

| If spine is… | Resolution / tool-save may say… | Must not say… |
| --- | --- | --- |
| visit `requested` | visit request saved; awaiting owner Confirm | booked / confirmed / scheduled (as done deal) |
| visit `confirmed` | visit confirmed | — |
| hold `open` | hold saved; awaiting owner Done | fulfilled / ready (as done) |
| hold `fulfilled` | hold done | — |

Needs you membership remains the owner source of truth for open Confirm / Hold Done. Resolution text is a summary, not a second status machine.

---

## P0 tickets (four honesty kills)

Ship as one desk PR or tightly stacked PRs; each kill is independently verifiable.

| # | Kill | ACCEPT test |
| --- | --- | --- |
| **K1** | Owner hangup / tool-save never says “booked a visit” while `requested` | Use exact copy: **“Visit request saved — confirm on desk.”** Staging call → requested appointment → transcript/summary/hangup match. |
| **K2** | `calls.resolution` / tool-save never disagrees with Needs you still wanting Confirm / Hold Done | Requested visit still on Needs you with Confirm; resolution ≠ booked/confirmed. Open hold still Needs you; resolution ≠ fulfilled. |
| **K3** | Desk When+Save updates `when_text` **and** `window_start` / `window_end` together | Edit When on visit and on hold → reload shows same instant in text and window fields; no text-only drift. |
| **K4** | Gate or remove hospitality **Confirm booking** until reservations exist | No Confirm booking affordance on desk for non-reservation tenants; home-services Confirm visit unchanged. |

---

## Out of scope / DEFER / KILL

**DEFER:** M-Pesa deposits, inventory SKU, Google Calendar, hold expiry cron, capacity OS / one-at-a-time switch, `hold_duration`.  
**KILL:** fake booked, soft-sent confirm, parallel status invent, Meta/IG in this slice, booking table, soft-hold.  
**Do not touch:** delivery vocab ladder, Platform notify ledger (separate), inbox verb cut (#371), contact strip (next after verb cut unless Chief reprioritizes).

---

## Seat

| Who | Does |
| --- | --- |
| Product | This ACCEPT spec (done) |
| Chief | Route UX → Builder → Release |
| Desk UX | Copy + control placement (K1/K4 surfaces) |
| Desk Builder | Resolution/tool-save agreement (K2), When+Save dual write (K3), voice hangup string (K1) |
| Critic | If any copy implies booked/sent without evidence |
| Release | Smoke K1–K4 on staging/preview |

## Kill / rollback

If any kill ships “booked” for `requested`, blocks Confirm on SMS fail, or adds a third spine → revert that PR. Prefer revert over patching lies.

## Verify (TEST)

1. Voice request visit → hangup string exact K1 · Needs you shows Confirm · resolution not booked.  
2. Confirm visit → status confirmed even if SMS failed · SMS line uses sent/failed vocab.  
3. When+Save on visit and hold → text + windows match after refresh.  
4. No Confirm booking control where reservations don’t exist.
