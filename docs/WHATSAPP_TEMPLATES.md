# Staff WhatsApp templates (Meta approval)

**Status:** Product lock. Submit these. Staff WhatsApp is template-only.  
**Lanes:** Ops (SautiKit / Meta WABA), Voice (send path)  
**Companion:** [`CALL_MESSAGE_CONTRACT.md`](./CALL_MESSAGE_CONTRACT.md)

WhatsApp to **clients** is a one-way ping to owner and permissioned staff. Same events and people as staff SMS. Not a chat. Not caller WhatsApp. Not inbound.

Every staff send uses a **Utility** template on the Scalers WhatsApp Business account (SautiKit `number_id`). Session text is not used. Cold staff phones have no 24-hour window.

## Submit

| # | Name | Use | When |
| --- | --- | --- | --- |
| 1 | `scalers_staff_alert` | Generic 3-line alert | **First.** Unblocks every staff event if kind templates are still pending. |
| 2 | `scalers_lead` | Missed-call lead | Inbox |
| 3 | `scalers_escalation` | One teammate handoff | Escalate |
| 4 | `scalers_visit` | Visit request / update / cancel | Inbox Visits |
| 5 | `scalers_request` | Hold / order / enquiry / callback | Inbox Holds |
| 6 | `scalers_wallet` | Prepaid low or empty | Ops. Scalers-paid. |
| 7 | `scalers_outage` | Speech or reasoning down | Ops. Scalers-paid. |

Do not submit caller templates in this batch. Do not submit quick-reply Confirm / Done buttons. Inbound is not wired. A button would look like it works and do nothing.

**Category:** Utility  
**Language:** English (`en`; set `SAUTIKIT_WHATSAPP_TEMPLATE_LANG=en_US` if Manager requires it)  
**Header:** none  
**Footer:** `Scalers`  
**Buttons:** none  
**Variables:** three body params on every template, never empty. No URLs in variables. No em dashes.

After approval, set on the voice host:

```
SAUTIKIT_WHATSAPP_TEMPLATE=scalers_staff_alert
SAUTIKIT_WHATSAPP_TEMPLATE_LANG=en
SAUTIKIT_WHATSAPP_TEMPLATE_LEAD=scalers_lead
SAUTIKIT_WHATSAPP_TEMPLATE_ESCALATION=scalers_escalation
SAUTIKIT_WHATSAPP_TEMPLATE_APPOINTMENT=scalers_visit
SAUTIKIT_WHATSAPP_TEMPLATE_SERVICE_REQUEST=scalers_request
SAUTIKIT_WHATSAPP_TEMPLATE_WALLET=scalers_wallet
SAUTIKIT_WHATSAPP_TEMPLATE_OUTAGE=scalers_outage
```

Kind env wins. If a kind name is unset, that event uses `SAUTIKIT_WHATSAPP_TEMPLATE` (generic). If that is unset too, the code default is the `scalers_*` name in the table.

Desk: `NEXT_PUBLIC_NOTIFY_WHATSAPP_AVAILABLE=true` (default on).

## Bodies to paste

### 1. `scalers_staff_alert`

```
{{1}}
{{2}}
{{3}}
Open the desk to act. Do not reply to this chat.
```

Example: `New missed-call lead. Done and Dusted Cleaning Services` / `Name: Jane. Phone: 254790381872` / `Reason: Book carpet cleaning`

### 2. `scalers_lead`

```
New missed-call lead. {{1}}
{{2}}
{{3}}
Open the desk to act. Do not reply to this chat.
```

`{{1}}` business. `{{2}}` name and phone. `{{3}}` reason.

### 3. `scalers_escalation`

```
Escalation for {{1}}. {{2}}
{{3}}
Open the desk to act. Do not reply to this chat.
```

`{{1}}` teammate. `{{2}}` business. `{{3}}` caller, phone, reason.

### 4. `scalers_visit`

```
{{1}}. {{2}}
{{3}}
Open Inbox Visits to confirm or cancel. Do not reply to this chat.
```

`{{1}}` `VISIT REQUEST` or `VISIT UPDATED` or `VISIT CANCELLED`. `{{2}}` business. `{{3}}` service, when, caller, phone.

### 5. `scalers_request`

```
{{1}}. {{2}}
{{3}}
Open Inbox Holds to mark fulfilled. Do not reply to this chat.
```

`{{1}}` `HOLD / PICKUP` or `ORDER` or `ENQUIRY` or `CALLBACK`. `{{2}}` business. `{{3}}` item, when, caller, phone.

### 6. `scalers_wallet`

```
{{1}}. {{2}}
{{3}}
Do not reply to this chat.
```

`{{1}}` `Scalers wallet running low` or `Scalers prepaid empty`. `{{2}}` business. `{{3}}` balance or on-demand state.

### 7. `scalers_outage`

```
{{1}}
{{2}}
{{3}}
Do not reply to this chat.
```

`{{1}}` the line-status sentence. `{{2}}` what callers heard or were asked. `{{3}}` `Open the desk to act.`

## Inbound is not these templates

Platform inbound already exists: someone texts the Scalers WhatsApp number, we mark read and send a short session-window ack. That is not a desk action. It does not confirm a visit. It does not list calls. Do not add buttons to these templates until that changes.

## Not this batch

| Template | Why not |
| --- | --- |
| Caller visit / hold / order / callback | Caller WhatsApp needs its own opt-in and approval. SMS only today. |
| Confirm / Done buttons | Inbound ack is a canned text. It does not confirm visits or list calls. |
| Marketing / missed-you / run-sheet reminder | Not staff alerts. |
| Swahili (`sw`) | Staff desk language is English. Add later as a second language on the same names. |

## Ops check

1. Templates approved on the Scalers WABA. Status Active. Utility.  
2. SautiKit number / connection id on Railway.  
3. Voice env names match the table.  
4. Desk WhatsApp toggle is live. Alert phone is the dest.  
5. Smoke: SMS off (or SMS fail) on a staging tenant, save a lead, staff phone gets the template, not a session text. Visit and wallet must not look like a missed-call lead.  
6. A reply to the alert does nothing in the desk. That is correct.

Code: `src/notifications/whatsappTemplates.js`, send in `whatsapp.js`.
