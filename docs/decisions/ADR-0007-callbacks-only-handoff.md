---
owner: voice
last_reviewed: 2026-10-14
---

# ADR-0007: Human handoff is callbacks only

- **Status:** proposed (Alvin approves)
- **Date:** 2026-10-14
- **Deciders:** Alvin Yegon; voice

## Context and problem statement

#658 (11 Oct 2026) replaced live-transfer promises with a Callbacks capability. Cold Dial after Stream failed on staging (ADR-0004). Desk had still offered `handoff_mode = live_transfer`.

## Considered options

1. Callbacks only: assistant takes name + reason and alerts a teammate on WhatsApp or email
2. Keep live transfer as an owner option behind `VOICE_LIVE_TRANSFER`
3. Build conference-based live transfer now

## Decision outcome

Proposed: Option 1. Never promise what the runtime cannot do; dead air after "connecting you" is worse than a callback. Supersedes ADR-0004.

### Confirmation

`CAPABILITY_IDS` in `src/conversation/capabilityGates.js` has `callbacks` and no `live_transfer`; `tests/capabilityGates.test.js`.
