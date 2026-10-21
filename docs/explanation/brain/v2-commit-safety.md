---
owner: brain
last_reviewed: 2026-10-21
---

# BA v2 commit safety (`BRAIN_V2_COMMIT_SAFETY`, off by default)

Plan row C1 (`briefs/v2-greeting-and-path-plan.md`). Code: `src/conversation/v2/commitSafety.js`, wired in `machine.js`.

**Rule (Scalers Chief, adopted):** anything that commits the business (booking/visit, order, quote, callback, cancel, move) needs a read-back plus a yes. Pure info enquiries do not.

| Step | What happens |
| --- | --- |
| Validators (before propose) | Opening hours / closed day (booking and order pickup), service area (tenant's listed areas; unlisted → "We don't cover X yet. We serve …" + a callback offer), availability (caller's own open visit at that slot; tenant `busySlots` when present, else recorded as `unchecked`). A failed validator never says "booked". |
| Propose | Mints a server-side confirm token bound to a hash of the normalized slots (`slotHash`). Receipt `proposed`. Callbacks read back the number **and** when (caller's time, else "today before <close>" / next open day). |
| Confirm | Only on the caller's next turn after the read-back, on an explicit whole-answer yes ("yes", "ndio", "sawa", "yes please") or a repeat of the read-back time (Alvin's rule), with no slot diff. "okay wait", questions, "but / lakini / ila" are not a yes. Any slot change re-proposes (receipt `rejected`, `slot_diff`). One yes/no re-ask when unclear. Receipt `confirmed`. |
| Commit | Idempotency key `call_id:tool:slotHash` goes to the write args (row column `idempotency_key`, Platform #691, only when `WRITE_RECEIPTS` is on) and to every receipt. A repeated confirm of the same key writes nothing new. Receipt `committed`. |
| Failure | The write fails → an outbox owner task (`escalate` reason `write_failed:<tool>`, kind `outbox`), receipt `failed`, the caller hears "Sorry, I couldn't save that. I've asked the owner to call you back." Outcome `write_failed`, never `booked`. If the outbox also fails: "Please call us again a little later." |
| Name | `confirmCallerName({ tenantId, phone, name, source: 'readback_yes', callId })` (Platform #844) only after a read-back yes; a no-op until #844's helper is in `db.js`. |

Receipts go through Platform #845 `recordWriteReceipt` (never throws; phases `proposed|confirmed|committed|failed|rejected`, `call_sid` from the HD_ SID).
