---
owner: brain
last_reviewed: 2026-10-22
status: reference
---

> **Reference only.** v2 staging test script as written by the Brain lane on 21–22 Oct 2026 for the draft stack. Staging only, never prod; it is not a record of results.
>
> Reference copy of the box brief `briefs/staging-test-script-v2-c3.md`. Paths under `/workspace/` are box paths and are not in the repo. See [STATUS.md](../../STATUS.md).

# Staging test script: v2 C3 "v2 owns the call" (`brain/v2-c3-owns-call`)

The draft PR is stacked on #849 (`brain/v2-c1-commit-safety`), which is stacked on #848. Platform builds the staging stack. **Never run this on prod.** Only SELECT on staging.

## Flag combination (staging)
| Var | Value | Why |
|---|---|---|
| `BRAIN_V2` | `on` | v2 Brain |
| `BRAIN_V2_MODE` | `live` | C3 acts only in live mode |
| `BRAIN_V2_TENANTS` | `<staging Done & Dusted tenant id>` | Scopes v2 to the test tenant |
| `BRAIN_V2_COMMIT_SAFETY` | `1` | C1. Implied by OWNS_CALL; set it anyway so the env reads clearly |
| `BRAIN_V2_OWNS_CALL` | `1` | C3 (this PR) |
| `VOICE_END_CALL_HONOUR` | `on` | C0. Without it, v2's goodbye is spoken but the call stays open |
| `WRITE_RECEIPTS` | unset, or `1` only once #691's `idempotency_key` SQL is applied | Key on the row |
| `brain_write_receipts.sql` (#845) | applied by Platform | Otherwise receipts are no_sink (call unaffected) |

The test tenant must have `agent_tools.end_call` on, or v2 never hangs up. Run one control call with `BRAIN_V2_OWNS_CALL` unset; it should behave as #849.

## After every call (SELECT only)
```sql
select summary->'brain_v2' as v2, resolution from calls where call_sid = '<CallSid>';
select phase, tool, idempotency_key, created_at from brain_write_receipts where call_sid = '<CallSid>' order by created_at;
select id, status, created_at from appointments where tenant_id = '<tenant>' and created_at > now() - interval '15 minutes';
```
(Use the real column names Platform has. `summary` is the call summary meta JSON that `mergeCallSummaryMeta` writes into.)

In the logs, grep the CallSid for `brain_v2_live owned`, `brain_v2_owned`, `brain_v2 finishCall`, `end-call signal`, `end_call hangup`. On every flag-on call there must be **no** `brain_v2_live failed, using v1`, no `tool guard`, no `file speech held`, and no Gemini model turn.

| # | Lang | Do / say | Expect to hear | Expect in logs / DB |
|---|---|---|---|---|
| 1 | EN | "What are your hours?" → "No thanks, that's all. Bye." | Hours from the profile, then "Thank you for calling. Goodbye." The line hangs up after the goodbye has played | One `end_call hangup`; `brain_v2 finishCall … outcome=answered` once; `calls.summary.brain_v2.ended_by_v2 = true` |
| 2 | SW | "Mnafungua saa ngapi?" → "Hapana, ni hayo tu. Kwaheri." | Swahili hours, then "Asante kwa kupiga simu. Kwaheri." The line hangs up | as 1 |
| 3 | EN | Booking: "Book sofa cleaning Friday at 10am in Kitengela, I'm Alvin." → "Yes" | Read-back, then "Done, your sofa cleaning is booked …" | 1 appointment; receipts proposed → confirmed → committed with one key; no `tool guard` line; `brain_v2.outcome = booked` |
| 4 | SW | "Nataka sofa cleaning Ijumaa saa nne asubuhi Kitengela, naitwa Njeri." → "Ndio" | "… Nithibitishe?" → "Sawa, nimeweka …" | as 3 |
| 5 | EN | After the goodbye in call 1, keep talking ("Hello? Are you there?") before the line drops | Nothing more is said | `turn after end dropped` or no turn; still one hangup |
| 6 | EN | Booking, then say "Yes" twice quickly | One "booked" | 1 row; the second yes is not a second write |
| 7 | EN | Callback: "Please have the owner call me back." → "Yes" | Read-back with the number and when → confirmation repeats both | 1 handoff; `brain_v2.outcome = handoff_callback` |
| 8 | EN | Hang up yourself mid-booking (before the yes) | n/a | `brain_v2 finishCall` once, outcome `abandoned_with_capture`; 0 rows |
| 9 | EN | Media drop / reconnect (Platform: kill the media socket during a call if the stack supports it) | The call carries on with the same v2 state (no re-asking for slots already given) | One finishCall for the CallSid, when the call really ends (a provisional close waits up to 90 s) |
| 10 | EN | **v2 error** (Platform only, optional): this cannot be triggered from a phone. It is covered by `tests/v2OwnsCallE2e.test.js` (v2 throws: the caller hears "Sorry, I didn't catch that. Could you say it again?" and zero v1 calls run) | — | — |
| 11 | EN | Returning caller with a file name / open booking, calling from that number: "What's my name?" and "Cancel my carpet booking" | **Observation only (accepted risk, Alvin 21 Oct 2026 16:36 EAT):** v2 may say the file name / open booking without an identity check. Not a pass/fail | Note exactly what was said |

## Control (flag off)
Run call 3 with `BRAIN_V2_OWNS_CALL` and `BRAIN_V2_COMMIT_SAFETY` unset. It should behave as #848/#849, and no `brain_v2` key should be written to the summary.

## Report back
For each call: CallSid, pass/fail, the exact line heard where it differed, the receipt phases, and the `brain_v2` summary JSON.
