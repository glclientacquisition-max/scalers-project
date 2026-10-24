---
owner: brain
last_reviewed: 2026-10-22
status: reference
---

> **Reference only.** v2 staging test script as written by the Brain lane on 21–22 Oct 2026 for the draft stack. Staging only, never prod; it is not a record of results.
>
> Reference copy of the box brief `briefs/staging-test-script-v2-c1.md`. Paths under `/workspace/` are box paths and are not in the repo. See [STATUS.md](../../STATUS.md).

# Staging test script: v2 C1 commit safety (`brain/v2-c1-commit-safety`)

The draft PR is stacked on #848 (`brain/v2-c0-lineage`). Platform builds the staging stack. **Never run this on prod.** Only SELECT on staging.

## Setup (Platform)
- Env: `BRAIN_V2=on`, `BRAIN_V2_MODE=live`, `BRAIN_V2_COMMIT_SAFETY=1`.
- Optional: `WRITE_RECEIPTS=1`. Set it only once #691's `idempotency_key` SQL is applied. Without it, the key goes on receipts only, not on the row.
- Receipts are stored only after Platform applies #845's `brain_write_receipts.sql`. Before that, `recordWriteReceipt` returns no_sink and the call is unaffected.
- Flag-off check: run one call with `BRAIN_V2_COMMIT_SAFETY` unset. It should behave exactly like #848.
- Use a tenant whose profile has service areas and one closed day. Call from a known test phone. Note each CallSid.

## After every call (SELECT only)
```sql
select phase, tool, idempotency_key, call_sid, created_at from brain_write_receipts where call_sid = '<CallSid>' order by created_at;
select id, status, idempotency_key, created_at from appointments where tenant_id = '<tenant>' and created_at > now() - interval '15 minutes';
select id, kind, reason, created_at from service_requests /* or escalations table */ where tenant_id = '<tenant>' and created_at > now() - interval '15 minutes';
```
Pass on every call means the agent never says "booked", "done" or "saved" unless a row exists.

| # | Lang | Caller says | Expect to hear | Expect in DB |
|---|---|---|---|---|
| 1 | EN | "Book sofa cleaning Friday at 10am in <listed area>, I'm Alvin." → "Yes" | Read-back: "Sofa Cleaning on Friday <date> at 10:00 in <area>, for Alvin. Shall I book it?" → "Done, your sofa cleaning is booked …" | 1 appointment; receipts proposed → confirmed → committed, all with the same key |
| 2 | SW | "Nataka sofa cleaning Ijumaa saa nne asubuhi <eneo>, naitwa Njeri." → "Ndio" | "… Nithibitishe?" → "Sawa, nimeweka …" | same as 1 |
| 3 | EN | same booking → "Okay wait" → "Yes" | "Take your time. Shall I book it?" → booked | 1 row; no commit on the "okay wait" turn |
| 4 | SW | same booking → "Ngoja kidogo" → "Ndio" | "Chukua muda wako …" → booked | 1 row |
| 5 | EN | booking → "Is it at 10?" → "Yes" | Answer/yes-no re-ask ("Please say yes or no: shall I book it?") → booked | the question turn writes nothing |
| 6 | EN | booking → "Yes but make it 2pm" or "Make it 2pm" → "Yes" | New read-back at 14:00 → booked at 14:00 | 1 row at 14:00; a `rejected` (slot_diff) receipt, then a new `proposed` with a new key |
| 7 | EN/SW | booking → repeat the time only: "Friday at 10am" / "Ijumaa saa nne" | Booked (Alvin's repeat-the-time rule) | 1 row |
| 8 | EN | booking → "Hmm" → "Hmm" | One re-ask, then a re-read; never booked | 0 rows |
| 9 | EN | booking on the closed day / after closing ("Friday 10pm") | Hours stated ("We're open from 08:00 to 18:00 …"), asks for another time; never "booked" | 0 rows until a valid time and a yes |
| 10 | EN | "Book sofa cleaning Friday 10am in Mombasa" → "Yes" | "We don't cover Mombasa yet. We serve …. Shall I ask the owner to call you back on <your number>, today before 18:00, about Mombasa?" → "The owner will call you back on …" | 0 appointments; 1 callback handoff |
| 11 | SW | same in Swahili ("… Mombasa") → "Ndio" | "Bado hatufiki Mombasa. Tunafika … Nimwombe mwenye biashara akupigie simu kwa namba …, leo kabla ya saa …" | 1 callback |
| 12 | EN | "Please have the owner call me back." → "Yes" (during hours) | Read-back has your number (as 0700 000 001) AND when ("today before 18:00") → the confirmation repeats both | 1 handoff |
| 13 | SW | "Naomba mwenye biashara anipigie." → "Ndio" | "… kwa namba …, leo kabla ya saa kumi na mbili jioni. Ni sawa?" → "Sawa. Meneja/Mwenye biashara atakupigia simu kwa namba …" | 1 handoff |
| 14 | EN | callback after closing time | "… tomorrow from 08:00" (next open day) | 1 handoff |
| 15 | EN | quote for a listed service → "Yes" | Read-back with number + when + "with a quote" | 1 quote request |
| 16 | SW | order "diary moja" → "Iwe mbili" → "Ndio" | Re-read with 2 → saved | 1 order, qty 2 |
| 17 | EN/SW | cancel / move an existing booking → "Yes" | Read-back of the change → done | 1 update, no new appointment |
| 18 | EN | booking → "Yes" → "Yes" again (double yes) | Second yes: no duplicate ("That's already saved; I haven't added it twice." or plain "Anything else?") | still 1 row |
| 19 | EN | Info only: "What are your hours?" | Answer only, no read-back | 0 rows, 0 receipts |
| 20 | EN | **Write failure** (Platform: on a disposable staging tenant, make the appointment insert fail, e.g. a temporarily revoked insert grant; or skip this and rely on the unit test) → "Yes" | "Sorry, I couldn't save that. I've asked the owner to call you back." Never "booked". | 0 appointments; an outbox owner task (reason `write_failed:create_booking`); a `failed` receipt; the owner summary says "could not save … Nothing was booked"; does NOT count as booked in A4 |

## Caller name (#844)
`confirmCallerName` runs only after a read-back yes (calls 1 and 2). It stays a no-op until #844's db function is in the stack, so expect no row change before that.

## Report back
For each call: CallSid, pass/fail, the exact line heard where it differed, and the receipt phases seen.
