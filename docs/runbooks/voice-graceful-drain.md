---
owner: platform
last_reviewed: 2026-10-15
---
# Voice server graceful drain (SIGTERM)

**What the code does** (`src/voiceDrain.js`, wired in `server.js`):
1. On SIGTERM it starts draining. New `/voice/incoming`, `/voice` and voice `POST /` webhooks (checked at the top of `handleVoiceIncoming`) get `<Response><Reject reason="busy"/></Response>` (caller hears busy and can redial; the new deployment answers). Webhooks for a call already live on this instance still pass.
2. New `/ws/media` upgrades get `503` unless the `callSid` is already live here.
3. `/healthz` returns **503** with `status: "draining"`, `activeCalls`, `pendingWork`, `drainStartedAt`. When not draining it returns 200 with `status: "ok"` and `activeCalls`.
4. It waits until active media sessions are 0 and call-end work (resolution, summary, terminal webhook writes) is done, or `VOICE_DRAIN_MAX_MS` (default 120000) passes, then exits 0.

**Railway settings (Voice service, staging and prod):**
- `RAILWAY_DEPLOYMENT_DRAINING_SECONDS` = **150**. That's the time between SIGTERM and SIGKILL; it must exceed `VOICE_DRAIN_MAX_MS` / 1000 plus margin. The default is 0 (immediate kill), which is why calls dropped on deploy.
- `RAILWAY_DEPLOYMENT_OVERLAP_SECONDS` = **30**, so the new deployment takes traffic before the old one is told to stop. New calls then land on the new instance while the old one finishes its calls.
- Optional: `VOICE_DRAIN_MAX_MS` (unset means 120000). Keep it below the draining seconds.
- Healthcheck path stays `/healthz` (the new instance reports 200 before it receives traffic).

**Pre-deploy check:** `curl -s $VOICE_URL/healthz | jq .activeCalls` should be 0, or accept the drain. This replaces grepping logs for `/voice/incoming`.

**Verify after a deploy:** old-deployment logs show `[drain] SIGTERM: refusing new calls …`, then `[drain] exit outcome=idle`. `outcome=timeout` means a call outlived the window; raise both values or investigate a stuck session.

**Rollback:** revert the PR. Setting the draining seconds back to 0 also disables the wait, since Railway kills immediately.
