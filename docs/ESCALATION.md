# Escalation feature (definition)

**Job:** When a caller needs a human, Scalers captures who they are and why, notifies the right teammate over the best available channel, confirms honestly on the phone, and leaves a desk trail the owner can act on.

Canonical code: `src/conversation/escalationFeature.js`, `requiredEscalate.js`, `escalation.js`, `toolExecution.js`, `src/notifications/{sms,dispatch}.js`, `server.js` (`maybeSendEscalationNotification`).

---

## 1. What “escalate” means (MVP)

| Is | Is not |
| --- | --- |
| Async handoff: notify teammate/owner + desk note | Live cold transfer (unless telephony later executes it) |
| Requires **caller name + reason** before notify | Guessing a name or inventing staff |
| Routes via `tenants.team_directory` | Sharing random phone numbers as “done” |
| Honest confirm after backend outcome | “I’ve transferred you” / “I’ve texted them” before send OK |

---

## 2. Lifecycle stages

```text
idle
  → human_requested          # caller asked for person/role
    → need_name              # ask once; speak immediately (no dead air)
      → ready                # name + reason known; escalate tool must fire
        → notifying
          → notified         # SMS and/or WA and/or email delivered
          → desk_only        # soft success: saved on call, no live channel
          → failed           # rare hard failure
```

Helpers: `deriveEscalationStage()`, `shapeEscalationNotifyOutcome()`.

---

## 3. Notify channel order (private beta)

1. **SMS** — TextSMS.co.ke (`TEXTSMS_API_KEY`, `TEXTSMS_PARTNER_ID`, `TEXTSMS_SHORTCODE`)
2. **WhatsApp** — SautiKit sender (when configured)
3. **Email** — Resend → tenant `alert_email`
4. **Desk note** — always saved; soft success if 1–3 miss

Owner prefs live on `tenants.notify_channels` (`{sms,whatsapp,email}`) and are edited in Business Settings → Agent Persona → **Notify channels**. Desk greys channels that are not platform-live yet (WhatsApp automated alerts = coming soon). Voice dispatch skips disabled prefs.

Boot + `/healthz` expose SMS `configured` vs **`verified`** (live balance probe). Env present ≠ working key.

---

## 4. Caller speech contract

| Situation | Caller hears |
| --- | --- |
| Human asked, name missing | Immediate ask for name (`pickClarifyProgress`) |
| Escalate running | Progress: “Okay, let me get the team on that.” |
| SMS/WA/email delivered | “Done — I've texted/sent it to the team.” |
| Desk-only soft success | “Done — I've noted that for the team to follow up.” |
| Invalid / missing name on tool | “Tell me your name so I can reach the team…” |

Never claim a live transfer unless a transfer executor actually runs.

---

## 5. Desk / data contract

Stored on `calls.summary` JSON (no migration):

- `escalated_to` — `{ name, role, phone }`
- `escalate_reason`
- `escalation_sent` — boolean (notify path finished, including soft)
- `escalation_notify` — `{ ok, soft, stage, channels[], reason, at }`

Resolution: `needs_human` when escalate succeeded or handoff requested without a completed request.

---

## 6. Tenant prerequisites

- `agent_tools.escalate = true` and `escalation_enabled = true`
- Team directory with at least one reachable person (phone and/or owner alert email)
- Prefer a **Floor Manager / General queries / owner** row with a real mobile for SMS

---

## 7. Improvement backlog (prioritized)

1. **Verify SMS live** — rotate TextSMS API key until `/healthz.notify.sms.verified === true`
2. **Desk UI** — show `escalation_notify.channels` on call detail (SMS vs desk-only)
3. **Per-tenant sender ID** (optional) when businesses register their own shortcodes
4. **Delivery receipts** — TextSMS DLR webhook → update `escalation_notify`
5. **Live transfer** — only when SautiKit transfer executor exists; keep async escalate as default
6. **Owner preference** — SMS vs WA vs email priority per tenant
7. **Quiet hours** — delay SMS, still desk-note immediately

---

## 8. Ops verify

```bash
# Balance probe (no SMS charged)
curl -sS "$VOICE_BASE/healthz" | jq .notify.sms

# Forced probe (needs VOICE_INTERNAL_SECRET in prod)
curl -sS -H "x-voice-internal-secret: $VOICE_INTERNAL_SECRET" \
  "$VOICE_BASE/internal/sms/status" | jq .

# Local script
node scripts/verify-textsms.js --to 2547XXXXXXXX
```

Live call pack: ask for Floor Manager → give name → expect escalate confirm + desk `escalation_notify`.
