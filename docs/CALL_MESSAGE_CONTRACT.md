# Call message contract

**Status:** Product contract for what Scalers texts after a call  
**Lanes:** Voice (send path), Ops & Billing (cost), Desk UI/UX (owner toggles)  
**Companion:** [`ESCALATION.md`](../ESCALATION.md), [`VOICE_DOWNTIME_AT_SCALE.md`](./agents/VOICE_DOWNTIME_AT_SCALE.md)

Two recipients. Never confuse them.

| Recipient | Who | Job of the message |
| --- | --- | --- |
| **Owner** | The business that pays Scalers | Know a caller needs action. Open the desk. |
| **Caller** | The business's customer | Know the business got their ask. Know what happens next. |

---

## 1. Owner messages (shipped)

All owner messages go through `src/notifications/dispatch.js` in this order: **SMS → WhatsApp → email**. Owner channel prefs live on `tenants.notify_channels`.

| Trigger | When | Body shape | Code |
| --- | --- | --- | --- |
| **Lead / callback** | `save_caller_info` with name + reason, or `call.completed` with both | `New missed-call lead — {Business}` + Name / Phone / Reason / Recording | `maybeSendWhatsAppNotification` |
| **Escalation** | Caller asks for a human; name + reason captured | `Escalation for {Teammate} — {Business}` + Caller / Phone / Reason | `maybeSendEscalationNotification` |
| **Service request** | Hold / order / enquiry created | `{HOLD\|ORDER\|ENQUIRY} — {Business}` + Item / Qty / When / Caller / Phone | `maybeSendServiceRequestNotification` |
| **Appointment** | Visit requested / updated / cancelled | `VISIT REQUEST — {Business}` + Service / When / Where / Caller / Status | `maybeSendAppointmentNotification` |
| **Wallet low / empty** | Prepaid balance crosses threshold | `Scalers wallet running low — {Business}` / `Scalers prepaid empty — {Business}` | `maybeNotifyWalletBalanceAlerts` |
| **Speech outage** | Soniox 402 / fatal | `{Business} line downtime. Callers heard a short message…` | `noteSpeechOutage` |
| **Reasoning outage** | Gemini credits / denied | `{Business} line is taking names only…` | `noteSpeechOutage` kind `llm` |

**Rules**

- One message per call per kind. `whatsapp_sent` on the call row prevents a duplicate lead text.
- Escalation and lead share the same `whatsapp_sent` flag today; an escalation marks it so the lead path does not re-send.
- Service request and appointment do **not** set `whatsapp_sent`; a call can produce a lead text and a request text.
- No vendor names, no "technical issue", no billing talk in the owner text.

---

## 2. Caller messages (not shipped)

Scalers does **not** text the caller today. The only caller-facing channel is the live call itself.

### Should we text the caller?

| Angle | For | Against |
| --- | --- | --- |
| Trust | Caller knows the ask was captured, not lost | A text from an unknown number can feel like spam |
| Conversion | "We got your booking for Tuesday" closes the loop | The business may want to confirm first |
| Cost | One SMS per actionable call is cheap | Every call texting is a new line item |
| Consent | Caller gave their number by calling | Kenya SMS marketing rules need opt-out |

### Recommended caller message (when it ships)

Only on **actionable** outcomes: appointment requested, hold placed, callback promised. Not on FAQ-only calls.

| Trigger | Caller text |
| --- | --- |
| Appointment requested | `{Business}: we have your visit request for {when}. We will confirm shortly.` |
| Hold placed | `{Business}: we have held {item} for you. We will confirm shortly.` |
| Callback promised | `{Business}: {Owner/team} will call you back.` |

**Rules**

- Send from the business's Scalers DID or a shared Scalers sender ID, not the owner's personal number.
- Include the business name so the caller knows who it is.
- One text per call. No follow-up marketing.
- Opt-out line when required: `Reply STOP to opt out.`
- Owner can turn caller texts off per workspace (`notify_channels.caller_sms` or similar).

---

## 3. Angles that decide each message

| Angle | Owner message | Caller message |
| --- | --- | --- |
| **Timing** | Immediate on save / call end | Immediate on action, or after owner confirms |
| **Channel** | SMS first (works on feature phones), WhatsApp second, email fallback | SMS only at first; WhatsApp needs template approval |
| **Language** | English (owner desk language) | Match the call language when known |
| **Content** | Name, phone, reason, recording link | Business name, what was captured, next step |
| **Cost** | Platform cost today; bundle into subscription later | Platform cost; per-text or bundle |
| **Opt-out** | Owner toggles `notify_channels` | Caller STOP; owner toggle |
| **Failure** | Log and leave desk note; do not retry storm | Log; do not retry on the same call |

---

## 4. What not to do

- Do not text the caller on every call. Only when there is an action to confirm.
- Do not send the caller a transcript or recording link.
- Do not let the caller text reveal internal notes (`resolution_note`, staff directory).
- Do not charge the tenant per owner SMS without a product decision.
- Do not send marketing to the caller. The first text is a confirmation, not a campaign.

---

## 5. Open decisions

1. **Caller SMS sender:** shared Scalers sender ID vs the tenant DID. Shared is simpler; tenant DID is more trusted.
2. **When to send:** immediately on tool success, or after owner confirms in the desk?
3. **Pricing:** is caller SMS bundled in the line fee, metered per text, or an add-on?
4. **Language:** match the call language, or always English?
5. **Opt-out:** is `Reply STOP` enough for Kenya, or do we need a registered sender with DLR?
