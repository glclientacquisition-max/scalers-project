# Staff WhatsApp templates (Meta approval)

**Status:** First template Active (`scalers_staff_alert` / `en`). Submit the rest. Staff WhatsApp is template-only.  
**Lanes:** Ops (SautiKit / Meta WABA), Voice (send path)  
**Companion:** [`CALL_MESSAGE_CONTRACT.md`](./CALL_MESSAGE_CONTRACT.md)

WhatsApp to **clients** is a one-way ping to owner and permissioned staff. Same events and people as staff SMS. Not a chat. Not caller WhatsApp. Not inbound.

Every staff send uses a **Utility** template on the Scalers WhatsApp Business account (SautiKit `number_id`). Session text is not used. Cold staff phones have no 24-hour window.

## Submit

| # | Name | Use | When |
| --- | --- | --- | --- |
| 1 | `scalers_staff_alert` | Generic 3-line alert | **Active.** First approval. Default for every staff event until a kind env is set. |
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

Kind env wins. If a kind name is unset, that event uses `SAUTIKIT_WHATSAPP_TEMPLATE` when set to a non-legacy name. If that is unset (or still `missed_call_lead`), the send path uses `scalers_staff_alert`. Do not set kind env until that kind name is Active.

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

## How to get them approved

SautiKit only **sends** templates. Meta **approves** them. There is no SautiKit create-template API in our send path.

Do this in **WhatsApp Manager** on the **Scalers** WABA (Cloud `phone_number_id` `1237105982825100`, number `+254709221536`). Do not submit on a shop WABA.

1. Open [Meta Business Suite](https://business.facebook.com/). Top left: the Scalers business portfolio.
2. Settings (gear) → Accounts → WhatsApp accounts → the Scalers account → **WhatsApp Manager**.
3. Account tools → **Message templates** → **Create template**.
4. Category: **Utility**. Not Marketing. Not Authentication.
5. Name: exact table name (`scalers_staff_alert` first). Lowercase, underscores, no spaces.
6. Language: **English (US)** in Manager. If sends then fail on language, set Railway `SAUTIKIT_WHATSAPP_TEMPLATE_LANG=en_US`.
7. Header: **None**. Footer: `Scalers`. Buttons: **None**.
8. Body: paste from this file. Keep `{{1}}` `{{2}}` `{{3}}` as numbered variables.
9. **Add sample** before submit. Meta rejects templates with empty samples.

| Var | Sample for `scalers_staff_alert` |
| --- | --- |
| `{{1}}` | `New missed-call lead. Done and Dusted Cleaning Services` |
| `{{2}}` | `Name: Jane. Phone: 254790381872` |
| `{{3}}` | `Reason: Book carpet cleaning` |

10. Submit. Status starts **Pending**. Decision is often minutes, can take up to 24 hours. Email goes to Business Suite admins. Usable status is **Active** (API `APPROVED`).
11. Repeat for the other six names. `scalers_staff_alert` is Active. Code already defaults to that name. Optional: set Railway `SAUTIKIT_WHATSAPP_TEMPLATE=scalers_staff_alert`. Smoke one staff phone with `node scripts/send-whatsapp-template.js --to +2547…` (dry-run first; `--apply` only on the owner machine).

If Meta recategorizes as Marketing, appeal as Utility: these are staff operational alerts the business already asked for, not promos. If rejected: add samples, drop any URL, keep Utility wording, resubmit.

`missed_call_lead` is legacy. The send path ignores that generic env unless `SAUTIKIT_WHATSAPP_TEMPLATE_ALLOW_LEGACY=on`.

## How unsaved contacts see "Scalers"

That is **not** a template header. A template header is a line inside the bubble. The name at the top of the chat (and in the chat list) is the **phone number display name** on this WABA.

Three layers. Only the last one guarantees the name without saving the contact.

| Layer | Where | What the staff phone shows |
| --- | --- | --- |
| 1. Display name set to `Scalers` | WhatsApp Manager → Account tools → Phone numbers → this number → Profile → Display name | Required. Must be **APPROVED**. |
| 2. Meta Business verification | Business Suite → Settings → Business info → verification | Helps. Without it, many phones still show `+254 709 221 536` in the chat list. |
| 3. Official Business Account | Meta notability / OBA on this number | Name (and blue tick) in the **chat list and chat thread even if the number is not saved**. This is the only Meta-guaranteed unsaved-name behaviour. |

Do this now (layers 1 and 2):

1. Same WhatsApp Manager → Account tools → **Phone numbers** → `+254709221536` (Scalers Cloud number, not a shop DID).
2. Profile → Display name → **Scalers**. Not `Done and Dusted`. Not `0709221536`. Not `Scalers Alerts`.
3. Wait until name status is **APPROVED**. If you **change** the name after it is already approved, wait for approval again, then **re-register** the number (SautiKit / Meta register). Re-registering before approval does nothing.
4. Set a **profile photo** (Scalers mark) and a short **About**. Unsaved users who open the thread still see these on the profile even when the chat list shows the number.
5. Complete **Business verification** on the Scalers portfolio (legal name, site, docs). Display name should match how Scalers is named on the public site.

Template **Footer: `Scalers`** is already in every body we submit. That brands the message itself. It does not replace the chat title.

Do not add a template HEADER called Scalers thinking that fills the chat list. It does not.

Voice on this E.164 is still Done and Dusted until a second DID exists. WhatsApp Cloud identity on the same number is Scalers. Keep those split. Park Calling.

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
