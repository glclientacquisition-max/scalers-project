---
owner: brain
last_reviewed: 2026-10-21
---

# BA v2 owns the call (`BRAIN_V2_OWNS_CALL`, off by default)

Plan row C3 (`briefs/v2-greeting-and-path-plan.md`). Code: `src/conversation/v2/ownsCall.js`, wired in `server.js` (the `/ws/media` turn, `applyGeminiTools`) and `src/callFinalize.js` (`onTerminal` hook).

It acts only with `BRAIN_V2=on` and `BRAIN_V2_MODE=live`, for tenants allowed by `BRAIN_V2_TENANTS`. With the flag on:

| Before (#849) | With `BRAIN_V2_OWNS_CALL=on` |
|---|---|
| A v2 exception, empty line or unplayed line fell through to the v1 lookup / local / Gemini turn | The caller hears the v2 repair template ("Sorry, I didn't catch that. Could you say it again?" / "Samahani, sijakusikia vizuri. Unaweza kurudia?"). No v1 path runs that turn |
| v2 writes went through `ensureRequiredCreateRequest`, `ensureRequiredEscalate` and `guardToolPlan` | A v2 plan goes to `executeBrainTools` as is. The executor's own row validation, the line-closed refusal and the fingerprint de-dupe stay. C1 commit safety (read-back, yes and token) is the guard |
| The v1 caller-file speech gate could hold or rewrite a v2 line | v2 lines are spoken with `skipFileGate` |
| v2 state lived in the media session, so a reconnect started a new v2 state | One runner per call sid (`createOwnedCalls`), so a reconnect keeps the state |
| After v2's goodbye, a v1 path could still answer | Once v2 has ended the call (end honoured by `VOICE_END_CALL_HONOUR`), `runCallerTurn` drops every turn. A reconnecting session asks for the same single hangup |
| `machine.finishCall` was never called live | `finishCall` runs once per call at the terminal event. A provisional media close waits out a 90 s reconnect window. Its outcome, owner text and C1 write receipts are merged into `calls.summary` meta as `brain_v2`, and `ownedV2Calls.finished(callSid)` returns the same object for A4 (#838) |

`BRAIN_V2_OWNS_CALL=on` also turns on `BRAIN_V2_COMMIT_SAFETY` (`commitSafetyEnabled`), because removing the v1 guards without C1's guard is not allowed. So the C1 place guards and validators apply too.

`end` is honoured only through Voice's contract (`VOICE_END_CALL_HONOUR=on`). With it off, v2's goodbye is spoken, the call stays open, and v2 keeps answering.

Not changed: Voice turn-taking runs before Brain and stays Voice's. That covers barge-in, the non-substantive-turn skip, the bare-greeting re-invite, idle nudges and the greeting. The greeting module is C6.

## Accepted risk: no caller-file identity check in v2

Decided by Alvin on 21 Oct 2026 at 16:36 EAT: v2 has **no** caller-file identity check. v2 lines skip the v1 caller-file gate (`skipFileGate`), and v2 has no binding rule of its own. So v2 can say the name on file ("I have your name as X") and read back open bookings on file to anyone calling from that number. Alvin accepts this risk. Staging call 11 records what is said; it is an observation, not a pass/fail gate.

## Staging flags

`BRAIN_V2=on BRAIN_V2_MODE=live BRAIN_V2_TENANTS=<staging tenant id> BRAIN_V2_COMMIT_SAFETY=1 BRAIN_V2_OWNS_CALL=1 VOICE_END_CALL_HONOUR=on`. Add `WRITE_RECEIPTS=1` only after #691's SQL is applied. Receipts land only after #845's `brain_write_receipts.sql` is applied.

Tests: `tests/brainV2ownsCall.test.js` (unit) and `tests/v2OwnsCallE2e.test.js` (the real `server.js` under the media sim).
