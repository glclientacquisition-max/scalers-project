# Caller reply: SMS, email, draft, polish

**Status:** Implemented on live Inbox + call page. Email to the caller is still dark (no contact email).  
**Not this:** Inbox master-detail prototype (`docs/specs/inbox-universal-prototype.md`).

**Lanes later:** Desk owns the row and composer. Brain owns draft/polish copy rules. Platform owns contact email column and any new send RPC. Ops owns SMS/email meters.

---

## 1. Need

The owner is looking at a row like Alvin, Missed, Yesterday. They already have two **device** actions: Call (`tel:`) and WhatsApp (`wa.me`). They still cannot:

- Text the caller from that row without opening the call, unless they already know to open the record.
- Email the caller at all. Voice almost never captures email. Contacts have no email column today.
- Ask the AI to **write** a reply from the call facts when the box is empty. Today Polish only rewrites a note the owner already typed. If the note is empty, Polish is disabled.

The job is one **caller reply**, not a new inbox layout. Staff alerts (escalate SMS / owner email) stay a different product.

---

## 2. Two products that must not mix

| | Staff alert | Caller reply |
| --- | --- | --- |
| Who | Owner or teammate | The person who called |
| Prefs | `notify_channels.sms` / `.whatsapp` / `.email` | `notify_channels.caller_sms` (Text customers). Email to caller is a **new** opt-in, default off. |
| Today | Voice dispatch + ledger | Auto templates on capture/confirm; desk Polish + Send SMS on the call page; WhatsApp is a personal `wa.me` link |
| Cost | Tenant SMS meter for SMS | Same meter for caller SMS. Email units reserved, not gated |

Do not put staff `alert_email` on the Alvin row. That emails the business, not Alvin.

---

## 3. What already exists (facts)

1. **Inbox row trailing icons** (missed / human / answered with a phone): Call, WhatsApp. Job/hold rows use Confirm / Done instead. No SMS icon. No email icon.
2. **Call page:** `CallerNoteComposer` only if Text customers is on. Owner types a short note (`rows={2}`), taps **Polish**, then **Send SMS**. Gemini rewrite. Local fallback if Gemini fails. Owner must tap Send. Never auto-send freeform AI. Body cap 320. Ledger `kind: caller_note`. Summary stores `caller_reply_body` / `caller_reply_at`.
3. **Polish prompt** (`POLISH_CALLER_SMS_SYSTEM`): one SMS. `Hi {Name}, {Business} here.` No invented time/service/place. No transcript, recording, staff directory, marketing.
4. **WhatsApp on the call page:** separate primary/link. Prefill from `followUpWhatsAppMessage`. Scalers does not send WhatsApp.
5. **Auto caller SMS** (capture, confirm, cancel, missed text-back) is a different path. Fixed templates. Not the composer.
6. **Contacts** are tenant + phone. No contact email field in `contacts_and_requests.sql`.
7. **Package email counters** exist. Do not gate caller email until Platform says consume is live.

---

## 4. Target object: one Caller reply

One draft text. One send. Channels are how it leaves.

```
Caller reply
  call_id
  contact_id?
  body                owner-editable
  source              owner | polish | draft | refine
  channels chosen     sms?  email?  (whatsapp is copy-out, not platform send)
  sent_at / last_error
```

**Polish:** owner wrote a note. Model rewrites that note. Same as today.

**Draft:** box is empty. Model writes from **call facts only** (name, business, want/reason, visit/hold slots, missed vs human). Same bans as Polish. If facts are thin (answered FAQ, no next step), refuse: `Nothing to send.` Owner can still type.

**Refine:** box already has a draft. Owner taps Refine (same control as Polish, or Polish stays the label). Model keeps intent, shortens, does not add facts.

Empty box + Polish is **Draft**. Non-empty + Polish is **Polish/Refine**. One control. Label can stay **Polish** so we do not add a second AI button.

---

## 5. Channel logic

### Call (keep)

`tel:` when a phone exists. Device places the call. Not a Scalers send. Not AI.

### WhatsApp (keep)

`wa.me` when a phone exists. Prefill = current body if the composer has text, else today’s follow-up helper. Device send. Not ledger-as-WhatsApp until templates exist.

### SMS (add as a quick action; keep send path)

Show the SMS control when all of:

- Phone exists
- Text customers is on
- Platform SMS is configured

Else: hide on the row, or mute with the existing copy (`Turn on Text customers in Business.` / Wallet cap). Do not send from the icon tap. Icon **opens the same composer**. Send is still **Send SMS**.

Cap, TextSMS sender, STOP, one customer text per owner Send: unchanged from `docs/CALL_MESSAGE_CONTRACT.md`.

If auto missed text-back already sent, the composer shows that body as sent. Draft must not duplicate the same apology on the same call unless the owner edits and sends again on purpose.

### Email (new, gated on address)

Show Email when the **contact has an email**. Voice will not invent one from the call.

Until Platform adds `contacts.email` (or equivalent), the control is **specified but dark**: muted, not a fake send. Capture email on the contact record first. Do not use `tenants.alert_email`.

When email ships:

- New opt-in, default off (name TBD: Text customers vs a sibling **Email customers**). Do not silently reuse staff `notify_channels.email`.
- Same `body` as SMS unless we later split a long email. v1: same 320-class body, subject `{Business}`.
- Meter later. Do not block in beta. Do not consume SMS units for email.
- Send is **Send email**, owner tap only. Polish/Draft still never auto-send.

---

## 6. Surfaces (same composer, two doors)

**Inbox row (the screenshot).** Icon cluster stays ghost/icon, not a second primary. Order: Call, SMS, Email, WhatsApp. Missing channel: omit, do not show a dead fourth icon for no reason. Tap SMS or Email opens the composer for that call (sheet on phone, split or dock on the call page). Do not fire SMS on the first tap.

Job/hold rows keep Confirm / Done as the row verb. Reply icons stay available if a phone exists; they must not replace Confirm.

**Call page (inside the chat).** One Reply block under Summary: textarea, Polish, then channel sends. WhatsApp stays the filled `#005CCC` CTA when it is the main follow-up (current rule). SMS Send stays ghost when WhatsApp is primary. Email Send ghost. No second layout. No instructional subcopy.

Do not build a different composer on Home.

---

## 7. Draft facts (what the model may use)

Allowed:

- Business name
- Real caller first name (same blocked list as Polish: calling, caller, unknown, …)
- Inbox stamp / purpose: Missed, Human asked, Confirm visit, Pickup, …
- Visit: service, when, landmark if saved
- Hold: item, when
- Owner note if present
- Call language when we later match SMS language (open decision in the message contract)

Forbidden:

- Transcript dump
- Recording URL
- Staff names, roles, internal phones
- Prices or promises not in the facts
- Marketing
- Staff alert content (`New missed-call lead…`)

Missed, no note: draft is the callback line, same spirit as missed text-back, owner still sends.

Human asked, no note: draft is callback, not the complaint detail.

Answered FAQ, no note: no draft. Owner types or leaves it.

---

## 8. Failure and cost

| Case | Behavior |
| --- | --- |
| No phone | No Call, SMS, WhatsApp |
| No email | No Email |
| Text customers off | No SMS send. Composer can still draft for WhatsApp paste |
| SMS cap, on-demand off | Send SMS errors with Wallet copy. Draft still works |
| Gemini down | Local fallback, same as today |
| Email not implemented | Control specified, not shipped |

---

## 9. Build order (when we continue)

1. Spec accepted (this file). No `/calls` layout change.
2. Desk: SMS icon on the live row opens the **existing** composer (call page or a thin sheet that reuses `CallerNoteComposer`). Empty-box Polish = Draft.
3. Brain: extend polish prompt for empty-note Draft from facts. Keep 320, keep bans. Tests in `tests/polishCallerNote.test.js`.
4. Platform: contact email field + capture on Contacts. Then Desk Email icon + send. Ops: email meter when gated.

Do not start with a new inbox table. Do not add lucide/shadcn/sidebar.

---

## 10. Open questions (do not invent in code)

1. Email opt-in: sibling of Text customers, or one **Message customers** with channel checks?
2. WhatsApp: stay device-only, or also paste the polished body into `wa.me` from the composer (likely yes, small)?
3. Inbox row: four icons vs overflow. Fitts: 32px min, 8px gap. Four may wrap on phone; then Call + WhatsApp stay, SMS/Email live only on the call page until we measure.
4. Language of Draft: English now, or call language when known?
