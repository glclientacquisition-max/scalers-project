# Call message contract

**Status:** Product contract for what Scalers sends after a call  
**Lanes:** Voice (send path), Ops & Billing (cost), Desk UI/UX (owner toggles)  
**Companion:** [`ESCALATION.md`](./ESCALATION.md), [`VOICE_DOWNTIME_AT_SCALE.md`](./agents/VOICE_DOWNTIME_AT_SCALE.md)

Two recipients. Never confuse them.

| Recipient | Who | Job of the message |
| --- | --- | --- |
| **Owner** | The business that pays Scalers | Know a caller needs action. Open the desk. |
| **Caller** | The business's customer | Know the business got their ask. Know what happens next. |

---

## 1. Event model

Every post-call notification is one typed event. Voice builds the event; `src/notifications/events.js` renders it; `dispatch.js` sends it on the best channel.

| Event | When it fires | Owner title | Caller text? |
| --- | --- | --- | --- |
| `lead` | `save_caller_info` with name + reason, or call ends with both | `New missed-call lead` + Intent / Summary / Outcome when known | No |
| `escalation` | Caller asks for a human; name + reason captured | `Escalation for {Teammate}` | No |
| `service_request` | Hold / order / enquiry created | `HOLD / ORDER / ENQUIRY` | Yes, when shipped |
| `appointment` | Visit requested / updated / cancelled | `VISIT REQUEST` | Yes, when shipped |
| `wallet_low` | Prepaid balance under threshold | `Scalers wallet running low` | No |
| `wallet_empty` | Prepaid balance ≤ 0 | `Scalers prepaid empty` | No |
| `outage_speech` | Soniox 402 / fatal | `Scalers line downtime` | No |
| `outage_llm` | Gemini credits / denied | `Scalers line taking names only` | No |
| `caller_appointment` | Visit requested | — | Yes, when shipped |
| `caller_hold` | Hold placed | — | Yes, when shipped |
| `caller_callback` | Callback promised | — | Yes, when shipped |

One event = one owner message per call per kind. `whatsapp_sent` on the call row prevents a duplicate lead text. Escalation marks it so the lead path does not re-send.

---

## 2. Channel ladder

Owner alerts use the first channel that works, in this order:

| Order | Channel | Provider | When it is used |
| --- | --- | --- | --- |
| 1 | **SMS** | TextSMS.co.ke | Always first when configured. Works on any phone. |
| 2 | **WhatsApp** | SautiKit | When SMS is not configured or fails. Needs `SAUTIKIT_WHATSAPP_NUMBER_ID`. |
| 3 | **Email** | Resend | Fallback when SMS and WhatsApp miss. |
| 4 | **Desk note** | Supabase call row | Always saved. Soft success if 1–3 miss. |

Owner channel prefs live on `tenants.notify_channels` (`{sms, whatsapp, email}`). At least one stays on.

Escalation adds a **teammate** step before the owner: SMS teammate → SMS owner → WhatsApp teammate/owner → owner email.

---

## 3. Owner message shapes

All owner bodies are plain text, ordered label rows, no vendor names, no "technical issue".

| Event | Body |
| --- | --- |
| Lead | `New missed-call lead — {Business}` + `Name:` / `Phone:` / `Reason:` / `Intent:` / `Summary:` / `Outcome:` / `Recording:` |
| Escalation | `Escalation for {Teammate} — {Business}` + `Caller:` / `Phone:` / `Reason:` |
| Service request | `{HOLD\|ORDER\|ENQUIRY} — {Business}` + `Item:` / `Qty:` / `When:` / `Caller:` / `Phone:` + `Open Requests in Scalers desk to mark fulfilled.` |
| Appointment | `VISIT REQUEST — {Business}` + `Service:` / `When:` / `Where:` / `Caller:` / `Status:` + `Open Appointments in Scalers desk to confirm or cancel.` |
| Wallet low | `Scalers wallet running low — {Business}` + balance + threshold |
| Wallet empty | `Scalers prepaid empty — {Business}` + on-demand state |
| Speech outage | `{Business} line downtime. Callers heard a short message and were asked to call back.` |
| Reasoning outage | `{Business} line is taking names only. Callers are asked for a name so the team can call back.` |

---

## 4. Caller messages (not shipped)

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

The template is **not generic**. It carries the business name, the caller's name when known, the specific thing captured, and the next step. No "your call was important to us".

| Trigger | Caller text |
| --- | --- |
| Appointment requested | `Hi {Name}, {Business} here. We have your {service} visit for {when}. We will confirm shortly.` |
| Hold placed | `Hi {Name}, {Business} here. We have held {item} for you. We will confirm shortly.` |
| Callback promised | `Hi {Name}, {Business} here. The team will call you back.` |

**Rules**

- Send from the business's Scalers DID or a shared Scalers sender ID, not the owner's personal number.
- Include the business name so the caller knows who it is.
- Use the caller's name when the call captured it. Skip it when it did not.
- Name the service or item. Do not say "your request" when we know it was carpet cleaning.
- One text per call. No follow-up marketing.
- Opt-out line when required: `Reply STOP to opt out.`
- Owner can turn caller texts off per workspace.

---

## 5. Angles that decide each message

| Angle | Owner message | Caller message |
| --- | --- | --- |
| **Timing** | Immediate on save / call end | Immediate on action, or after owner confirms |
| **Channel** | SMS first, WhatsApp second, email fallback | SMS only at first; WhatsApp needs template approval |
| **Language** | English (owner desk language) | Match the call language when known |
| **Content** | Name, phone, reason, recording link | Business name, what was captured, next step |
| **Cost** | Platform cost today; bundle into subscription later | Platform cost; per-text or bundle |
| **Opt-out** | Owner toggles `notify_channels` | Caller STOP; owner toggle |
| **Failure** | Log and leave desk note; do not retry storm | Log; do not retry on the same call |

---

## 6. What not to do

- Do not text the caller on every call. Only when there is an action to confirm.
- Do not send the caller a transcript or recording link.
- Do not let the caller text reveal internal notes (`resolution_note`, staff directory).
- Do not charge the tenant per owner SMS without a product decision.
- Do not send marketing to the caller. The first text is a confirmation, not a campaign.
- Do not add a fourth owner channel without adding it to the ladder and the event model.

---

## 7. Open decisions

1. **Caller SMS sender:** shared Scalers sender ID vs the tenant DID. Shared is simpler; tenant DID is more trusted.
2. **When to send:** immediately on tool success, or after owner confirms in the desk?
3. **Pricing:** is caller SMS bundled in the line fee, metered per text, or an add-on?
4. **Language:** match the call language, or always English?
5. **Opt-out:** is `Reply STOP` enough for Kenya, or do we need a registered sender with DLR?

---

## 8. Owner insight without the dashboard

The owner lead text is not a label dump. When the Brain has persisted intent, summary, and resolution, the SMS carries them:

```
New missed-call lead — Done and Dusted Cleaning Services
Name: Jane
Phone: +254790381872
Reason: Book carpet cleaning
Intent: book_visit
Summary: Intent: book_visit. Caller: Jane. Goal: carpet cleaning tomorrow.
Outcome: Visit request saved
Recording: https://…
Open call: https://scalers-project.vercel.app/calls/{call_id}
```

The owner knows who called, what they wanted, and what happened without opening the desk. One tap on `Open call:` opens the exact conversation.

The link is the desk call detail (`/calls/{id}`). Set `DESK_PUBLIC_URL` (or `NEXT_PUBLIC_APP_URL`) on the voice host so the link points at the right desk.

**Gemini does not need Supabase access.** The Brain already derives intent, summary, and resolution from live STT during the call and writes them to `calls.summary` / `calls.primary_intent` / `calls.resolution_note`. The notify path reads that row. No second model call, no extra cost, no live DB access from Gemini.
