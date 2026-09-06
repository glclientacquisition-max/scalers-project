# Live human transfer (caller escalation to a real person)

**Status:** Spec plus gated executor. Default `VOICE_LIVE_TRANSFER=off`. Tenant option is Business → Train → Escalation Team (`handoff_mode`). Brain sets `liveTransfer` only when that option, open hours, a directory phone, and the env flag all pass.  
**Job:** When a caller needs a human *and* the business opted in, Scalers leaves the AI media stream and bridges the live call to a real teammate. If the bridge cannot run or the human does not answer, the existing async escalate path still notifies and the caller hears an honest fallback.

**Related:** async notify is already shipped in [`ESCALATION.md`](./ESCALATION.md). Decision record: [`adr/ADR-0004-live-human-transfer.md`](./adr/ADR-0004-live-human-transfer.md).

---

## 1. Product definition

Two different products share the word “escalation”. Do not collapse them.

| Mode | What the caller gets | Owner setting | Runtime today |
| --- | --- | --- | --- |
| **Callback** (async escalate) | AI stays on the line, takes name + reason, texts/emails the teammate, confirms follow-up | `tenants.handoff_mode = callback` (default) | **Shipped** |
| **Live transfer** | AI says it will connect, then the PSTN bridges to a teammate’s mobile. AI leaves the call | `tenants.handoff_mode = live_transfer` on Escalation Team | **Gated.** Executor present; Dial only if `VOICE_LIVE_TRANSFER=on` |

Live transfer is **opt-in per tenant**. Kenya shops that cannot pick up during the day keep callback. Never auto-upgrade a tenant because they filled in a team phone.

### What live transfer is

- A **cold bridge**: stop Soniox/Gemini on `/ws/media`, then SautiKit `<Dial>` to one E.164 from `team_directory`.
- Same teammate picker as escalate (`resolveEscalation`).
- A **desk trail** plus a **pre-ring SMS** so the human knows who is calling and why *before* they answer.
- Honest speech: “connect you” only after the transfer executor is actually running.

### What it is not (v1)

- Warm transfer (AI whispers a briefing into the teammate’s ear while the caller waits on hold).
- Multi-party conference / queue / IVR “press 0”.
- SIP / PBX extension dial.
- Inventing staff or dialing a number that is not on the tenant’s directory.
- Promising “I’ve put you through” before Dial is issued, or after Dial failed.

---

## 2. Why this shape (best way on the current stack)

The live path is SautiKit **Stream XML** (`connect="true"`) → `wss /ws/media` → Soniox STT/TTS. Brain already has a `TRANSFER` action, gated on `runtime.liveTransfer === true`, which `server.js` sets **false** on every call.

SautiKit already documents `<Dial>` to an E.164 number (same destination rules as `POST /v1/calls`). SautiKit also re-invokes `voice_callback_url` on Stream lifecycle edges. Today `/voice/incoming` **must not** re-issue `<Stream/>` on those edges (`shouldSkipMediaStream`); it returns empty `<Response/>`.

That empty-response hook is the transfer executor’s insertion point:

1. While the AI stream is up, persist a **pending Dial**.
2. Stop the media WebSocket so the Stream ends cleanly (do not hard-hangup the PSTN caller).
3. On the StreamStopped / StreamCompleted webhook, return **`<Dial>`** instead of empty XML.
4. If Dial times out or is busy, the next webhook returns **`<Say>` fallback + hangup** (or re-notify). Stream is already gone, so Gemini cannot talk.

Warm conference (`POST /v1/calls` into a named room, AI stays until the human joins) is better UX but doubles outbound cost, needs a whisper path, and fights the current single-stream media loop. Defer to v2 after cold Dial is proven on a staging DID.

---

## 3. Requirements

### 3.1 Functional

| ID | Requirement |
| --- | --- |
| F1 | Tenant can choose callback vs live transfer in Settings. Default remains callback. |
| F2 | Live transfer runs only when **all** runtime gates in §4 pass. Otherwise Brain uses ESCALATE (today’s notify path). |
| F3 | Caller name + reason still required before any human handoff (same as escalate). Ask once; no dead air. |
| F4 | Destination is only a `team_directory` phone, normalized to E.164. No free-typed numbers from the model. |
| F5 | After hours: if `after_hours_mode = message` **or** the shop is closed, **do not Dial**. Use callback escalate. Exception only if a later setting `transfer_after_hours = true` is added (not in v1). |
| F6 | Before Dial, persist `saveEscalation` and send the existing SMS/WA/email alert (best-effort). Human should not get a mystery ring. |
| F7 | Caller hears progress (“Okay, let me connect you.”) then ringback from Dial. Never silence. |
| F8 | If Dial is not answered / busy / failed / unauthorized destination: mark transfer failed, keep the escalate notify, tell the caller they will be followed up, then hang up. Do not claim they were connected. |
| F9 | Call detail shows transfer attempt (pending / bridged / failed / fallback_notify) plus escalate notify channels. |
| F10 | Wallet: inbound AI minutes **and** outbound Dial minutes are both billable SautiKit usage. Ops must not drop the existing inbound `chargeCallToWallet` path. |
| F11 | Feature flag `VOICE_LIVE_TRANSFER=off` (default) until the Stream-stop → Dial lab spike passes on staging. Tenant toggle cannot override a global off. |

### 3.2 Honesty / speech (non-negotiable)

Same contract as Brain invariant 9, extended:

- Never say “I’ve transferred you” in the same turn as the tool marker.
- Never say it unless Dial was actually returned to SautiKit.
- If gates fail: use escalate copy (“I’ve noted that for the team”) not transfer copy.
- Desk compiler stays: `handoff_mode` is a **preference**, not proof transfer works.

### 3.3 Non-functional

- Transfer decision + Stream stop should start within one conversational turn after name is known (no extra Gemini round-trip after the transfer tool succeeds).
- One destination, timeout ~25–30s (configurable env, not per-tenant in v1).
- Idempotent: a second TRANSFER on the same call is a no-op if Dial is already pending or bridged.
- PII: SMS body already has caller name/phone/reason; do not log full numbers in Brain traces.

---

## 4. Runtime gates (`liveTransferReady`)

`buildBrainCapabilities(..., { liveTransfer })` stays the single authority. Set `liveTransfer: true` **only** when every check is true:

```text
VOICE_LIVE_TRANSFER=on
AND tenant.handoff_mode === 'live_transfer'
AND agent_tools.escalate !== false          # transfer reuses escalate permission
AND shop is open (or after_hours_mode === 'serve' while open-unknown is treated as closed)
AND resolveEscalation(...).teammate.phone is valid E.164
AND SautiKit API can Dial (key present; destination not on a block list)
AND no transfer already pending/bridged on this callSid
AND telecom wallet / billing enforcement does not forbid a new outbound leg
```

If any check fails → `liveTransfer: false` → next-best-action stays **ESCALATE** (already implemented).

`handoff_mode = live_transfer` alone must **not** enable Dial. Tests already cover this (`tests/brainCore.test.js`).

---

## 5. How a call should work

```text
Caller: "I want to talk to the owner"
  → intent=human, ask name if missing (immediate clarify line)
Caller: "James. Stock question."
  → resolveEscalation(team_directory, "owner") → e.g. Amina, +2547…
  → if liveTransferReady: NBA=TRANSFER else NBA=ESCALATE

TRANSFER path
  1. Speak progress: "Okay, let me connect you."
  2. Tool: transfer { teammate, name, reason }  (or escalate payload + executor=dial)
  3. DB: saveEscalation + transfer_attempt={ status: pending, to, timeout }
  4. Notify SMS/WA/email (existing dispatch; do not block Dial on SMS failure)
  5. Stop STT/TTS; close /ws/media without hanging up the caller leg
  6. SautiKit POSTs StreamStopped → POST /voice/incoming
  7. Incoming sees pending transfer → return Dial XML (callerId = tenant DID)
  8a. Human answers → bridged. AI is gone. status=bridged. Call completes on hangup.
  8b. Timeout/busy/fail → webhook → Say fallback → hangup. status=failed, fallback_notify.

ESCALATE path (unchanged)
  Notify + honest confirm, AI stays on the line.
```

### Dial XML (illustrative)

```xml
<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial callerId="{tenant_did_e164}" timeout="30" record="true">
    <Number>{teammate_e164}</Number>
  </Dial>
</Response>
```

`callerId` is the **business DID**, not the original caller, unless Ops later adds a “present original CLI” flag (carrier-dependent). Teammate SMS includes the caller’s number so they can call back if they miss the bridge.

### Fallback Say (illustrative)

```xml
<Response>
  <Say>I could not reach the team just now. They have your message and will follow up.</Say>
  <Hangup/>
</Response>
```

Do not re-open `<Stream/>` on failed Dial in v1. Re-entry races `shouldSkipMediaStream` and greeting logic.

---

## 6. Data contract

Reuse `calls.summary` JSON (same pattern as `escalation_notify`). **No new column required for v1.** Platform may add typed columns later if desk filters need them.

```json
{
  "escalated_to": { "name": "Amina", "role": "Owner", "phone": "+2547…" },
  "escalate_reason": "Stock question",
  "escalation_sent": true,
  "escalation_notify": { "ok": true, "soft": false, "stage": "notified", "channels": [] },
  "transfer_attempt": {
    "status": "pending",
    "mode": "cold_dial",
    "to": "+2547…",
    "caller_id": "+2547…",
    "timeout_s": 30,
    "started_at": "ISO-8601",
    "ended_at": null,
    "sautikit_dial_status": null,
    "error": null
  }
}
```

`transfer_attempt.status`: `pending` → `dialing` → `bridged` | `failed` | `cancelled`.

Resolution: keep `needs_human`. If bridged, desk can still show `needs_human` plus transfer status; do not mark the lead resolved just because someone picked up.

`src/db.js`: add `saveTransferAttempt({ callSid, attempt })` as a thin wrapper over `mergeCallSummaryMeta`. Do not break `saveEscalation`.

---

## 7. Desk UX (Train → Escalation Team)

Settings already persist `handoff_mode` (`callback` | `live_transfer`). The owner control lives on **Business → Train → Escalation Team**, next to the team directory (not under Tools & voice).

- **Message teammate:** AI stays on the line; SMS / WhatsApp / email.
- **Connect live call:** rings a directory phone during open hours; messages them if they miss it.

Live transfer is selectable even without a phone, but the panel states that Scalers will message until a team phone exists. After the executor exists:

- Live Dial still requires `VOICE_LIVE_TRANSFER=on` plus open hours.
- Call detail shows `transfer_attempt.status` next to escalation notify.
- Copy: no em/en dashes. Primary CTA remains Save (`#0096FF`).

Do not add a second team editor. Directory stays the single source of destinations.

---

## 8. Billing and ops

- Inbound Stream minutes: existing `chargeCallToWallet` on call complete.
- Outbound Dial minutes: SautiKit bills the workspace; Scalers must record duration when `/voice/events` reports the Dial leg. If events do not split legs, charge the full parent call duration once (document the gap) rather than double-charge.
- Destination authorization: SautiKit Dial is subject to the same allow-list as `POST /v1/calls`. Ops must confirm Kenya mobiles on the directory are authorized before turning `VOICE_LIVE_TRANSFER=on` for a tenant.
- Super Admin: optional later flag per tenant; v1 uses env + `handoff_mode` only.

---

## 9. Implementation plan (one lane per PR)

Do **not** land Voice Dial, Brain prompt copy, Desk copy, and SQL in one PR. Sequence:

### Spike 0 — Voice (blocking)

Lab on staging DID, no product toggle:

1. From a live `/ws/media` session, close the WS (or documented stream-stop) **without** dropping the caller.
2. Confirm `/voice/incoming` receives StreamStopped/Completed.
3. Return `<Dial>` to a known mobile; confirm ring and two-way audio.
4. Confirm timeout path can return `<Say>` + `<Hangup>`.
5. Write findings in `docs/agents/LIVE_CALL_FINDINGS.md`.

If closing the WS hangs up the caller, stop and evaluate SautiKit `Redirect` / conference instead. Do not enable `liveTransfer` on production.

### PR 1 — Platform

- Document summary JSON shape (this file is the contract).
- `saveTransferAttempt` on `src/db.js`.
- Unit/smoke only; no SQL unless desk filtering demands a column.

### PR 2 — Voice

- In-memory pending-transfer map keyed by `callSid` (plus DB persist).
- `/voice/incoming`: if pending Dial and skip-stream edge, return Dial XML; if Dial failed, return Say+Hangup.
- Media handler: on TRANSFER execute, stop session cleanly.
- Keep `liveTransfer: false` until spike 0 is green; gate with `VOICE_LIVE_TRANSFER`.
- Tests: webhook XML snapshots (`tests/voiceWiring.test.js` or new `tests/liveTransferWebhook.test.js`).
- Gate: `npm run test:voice`.

### PR 3 — Brain

- `liveTransferReady` helper used by `server.js` when building capabilities.
- Transfer tool marker (reuse escalate payload if possible; add `transfer` only if the executor needs a distinct fingerprint).
- Prompt / playbook: claim connect **only** when AUTHORITY says live transfer available.
- Required-transfer inject analogous to `requiredEscalate.js` when NBA is TRANSFER and name is known.
- Gates: `npm run test:brain` and `npm run test:mvp`.

### PR 4 — Desk UI/UX

- Honest readiness copy and call-detail transfer row.
- Gate: `cd dashboard && npm run lint && npm run build`.

### PR 5 — Ops (as needed)

- Wallet / event duration for Dial legs.
- Staging checklist: authorized destination, TextSMS still fires pre-ring.

---

## 10. Test plan

| Layer | What |
| --- | --- |
| Brain unit | `liveTransfer: true` → NBA TRANSFER; `false` + `handoff_mode=live_transfer` → ESCALATE |
| Voice unit | StreamStopped + pending → Dial XML; no pending → empty Response (today) |
| Webhook | Dial timeout body → fallback Say, never a second Stream |
| Smoke | Staging: ask for owner, give name, hear connect line, phone rings, talk, hangup; desk shows bridged |
| Negative | Closed hours + live_transfer pref → SMS escalate, no Dial |
| Negative | Directory person with no phone → escalate/fallback, never Dial empty Number |

---

## 11. v2 backlog (do not mix into v1)

1. Warm conference + outbound agent leg + whisper summary.
2. DTMF 0 to request a human.
3. Sequential Dial to backup numbers.
4. Present original caller CLI when the carrier allows it.
5. Transfer after hours opt-in.
6. Re-enter AI Stream after a missed Dial (hold music, try again).

---

## 12. Source of truth (after implementation)

| Piece | Owner | Path |
| --- | --- | --- |
| Capability bit | Brain | `src/conversation/brainPolicy.js` `liveTransfer` |
| Next action | Brain | `src/conversation/nextBestAction.js` |
| Teammate pick | Brain | `src/conversation/escalation.js` |
| Stream stop + Dial XML | Voice | `server.js` `/voice/incoming` + `/ws/media` |
| Persist attempt | Platform | `src/db.js` `saveTransferAttempt` |
| Tenant preference | Desk + DB | `tenants.handoff_mode` |
| Global kill switch | Voice env | `VOICE_LIVE_TRANSFER` |
