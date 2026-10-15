---
owner: platform
last_reviewed: 2026-10-14
---
# SautiKit recording fetch returns 403

**Symptom:** logs show `[sautikit] recording fetch denied status=403` (once per hour at most), and calls carry `recording_status: unavailable`, `recording_unavailable_reason: provider_scope` in `calls.summary`.

**Path:** `GET {SAUTIKIT_API_BASE}/v1/calls/{id}/recording` with `Authorization: Bearer SAUTIKIT_API_KEY` (`src/sautikit/recordingFetch.js`), called from `attachProviderRecording` in `server.js` when the hangup event carries no recording URL (`scheduleRecordingFetch`, +8 s).

**Cause:** the service key only has `wallet.read` (or another scope set without call recordings). 401/403 is a scope or credential problem, not a pending recording, so retrying cannot help.

**Behaviour since this fix:** the first 401/403 latches for 1 hour. One warning is logged, no further recording API calls or delayed retries are made in that window, and affected calls are marked unavailable instead of logging `recording fetch pending` and `recording missing URL`.

**Fix (manual, owner: Alvin/Platform):** remint the SautiKit API key in the SautiKit dashboard with call-recording read scope (plus `wallet.read`, which the wallet probe needs), and set it as `SAUTIKIT_API_KEY` on the service. A restart clears the latch; otherwise it clears itself within an hour. Never paste the key into chat or logs.
