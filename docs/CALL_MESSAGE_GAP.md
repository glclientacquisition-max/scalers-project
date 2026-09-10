# Call message gap: live SMS vs excellence

**Status:** Staging corpus, 2026-09-01 to 2026-09-10 (Done and Dusted / Shy, DID `+254709221536`)  
**Contract:** [`CALL_MESSAGE_CONTRACT.md`](./CALL_MESSAGE_CONTRACT.md)  
**Lane:** Voice send path; Brain for names and intent; Desk for `DESK_PUBLIC_URL`

Bodies below are reconstructed from `calls.summary` plus `ownerLeadEvent`. The send path does not yet persist `owner_notify_body`.

---

## Current position

The ladder works. Real leads and escalations fire. Greeting-only calls with no name do not text the owner. Caller SMS is correctly off.

The excellence bar is not a missing channel. It is the **payload**. Owners still get a label dump of live Brain fields, taken **before** hangup review. Reason is often already good. Intent, Summary, and Outcome usually make the text worse.

| Layer | Bar | Live |
| --- | --- | --- |
| Who to text | Owner on actionable capture; caller never, until toggled | Owner yes; caller none |
| When | After the ask is known, with a usable summary | On `save_caller_info` mid-call |
| Name | Real person name | `Haijawekwa`, `Calling`, `Callings`, `Alvin.` |
| Reason | What they wanted | Usually the best line in the SMS |
| Intent | `book_visit`, `order_enquiry`, `human` | Stuck `general_enquiry` at send time |
| Summary | One owner sentence | Last-turn STT (`How are you doing, Shy?`, `Mm-hm.`) |
| Outcome | What Scalers did | Internal Brain notes (`permitted end-call action`) |
| Volume | One owner text per call | Lead plus ENQUIRY or VISIT on the same call |
| Open call | Deep link | Only if `DESK_PUBLIC_URL` is set on Railway |
| Production | Same bar | Last real owner lead: 2026-08-14 `HD_f68f90b2c563` |

Hangup `owner_review` is already the better source. It lands 1 to 2 minutes after the SMS, so it never makes the text.

---

## Caller SMS (client to their customer)

This is the other recipient in the contract: the business's customer, not the Scalers owner.

**Live position:** off until the owner turns on **Text customers** (`notify_channels.caller_sms`, default false). Templates and send path exist. Capture, confirm, cancel, hold, order, and callback are the only triggers.

The live call is still the only thing the customer hears. That is why a booking can be saved and the caller still has no written proof.

### Same corpus: what the customer would have received

Contract: text the caller only on appointment, hold, or promised callback. Not on FAQ, not on enquiry, not on every lead.

| SID | What happened | Send? | Excellence text |
| --- | --- | --- | --- |
| `HD_29b949b1e0f0` | Airbnb clean tomorrow 8:00 AM Runda | Yes | `Hi Alvin, Done and Dusted Cleaning Services here. We have your general cleaning visit for tomorrow at 8:00 AM. We will confirm shortly.` |
| `HD_60edbb89422b` | Mattress tomorrow 10 AM Rongai | Yes | `Hi Alvin, Done and Dusted Cleaning Services here. We have your mattress cleaning visit for tomorrow at 10 AM. We will confirm shortly.` |
| `HD_af5d6344b42b` | Visit updated Tuesday 10:00 AM | Yes, once | Same shape with the new when. Do not send a second text if create already fired. |
| `HD_16dd2b701133` | Couch Runda tomorrow 8:30 AM | Yes if a visit row was saved | Name the service and the slot. |
| `HD_3f7ed2a5f526` | Roof cleaning **enquiry** | No | Asking about a service is not a booking. Owner gets the lead. Caller does not get "we will confirm shortly". |
| `HD_e8d4ee7283b5` | Covers Kericho? | No | FAQ / coverage. |
| `HD_43492e7e296e` | Medical emergency Ruaka | No | Human path. Do not SMS `Hi Haijawekwa`. |
| `HD_0a8d5911d055` | "Calling is my name", wants a human | Callback only if the agent promised a call back | `Hi, Done and Dusted Cleaning Services here. The team will call you back.` Skip the fake name. |
| Greeting-only hangups | No capture | No | Correct silence. |

### How this would fail if we wired it naively

The owner gaps become customer-facing spam:

1. **Fake names.** `Hi Haijawekwa` / `Hi Calling` from the same STT bugs.
2. **Wrong trigger.** Enquiry and "save_caller_info" would look like a confirmed booking.
3. **Unknown sender.** TextSMS shortcode, not `+254709221536`. The customer called a DID and gets a text from a different ID.
4. **Language.** Swahili calls (`HD_43492e7e296e`, `HD_ea33941e0a5c`) would get English unless we match `summary.language`.
5. **Timing.** Immediate on tool success can confirm a slot the owner has not accepted. After owner confirms in the desk is safer for home services; slower for trust on the call.
6. **Double send.** Create + update + lead would stack three customer texts the way owner SMS already stacks.
7. **No STOP / no owner off switch.** Contract requires both before this is legal-looking in Kenya.

### Bar to ship against

| Decision | Bar |
| --- | --- |
| Who | The person who just called, on their `from_number` |
| When | Appointment requested, hold placed, or callback promised. Zero otherwise. |
| Copy | Business name + specific service/item + when + next step. Templates already in `renderCallerText`. |
| Name | Same `displayOwnerCallerName` gate. If blocked, `Hi, {Business} here`. |
| Volume | One SMS per call. Updates wait or replace, they do not add a second text. |
| Sender | Open: shared Scalers shortcode vs tenant DID. DID is more trusted. |
| Toggle | Owner default **off** until copy and sender are proven on staging. |
| Not this | Transcript, recording link, staff names, marketing, WhatsApp to the customer (needs a template). |

---

## What went out (staging, `whatsapp_sent`)

Silent / no-name calls are omitted. Those are correct non-sends.

### A. Usable reason, poisoned Summary / Outcome

These are the common case. Keep Reason. Drop live Summary and internal Outcome.

| SID | UTC | Name | Reason (good) | What poisoned the SMS |
| --- | --- | --- | --- | --- |
| `HD_3f7ed2a5f526` | Sep 10 06:33 | Alvin | Roof cleaning services | Summary `Goal: How are you doing, Shy?`. Intent live `general_enquiry`. Review later `order_enquiry`. Extra ENQUIRY SMS for Roof cleaning. Outcome `permitted end-call action`. |
| `HD_374aafdeb542` | Sep 10 03:46 | Alvin. | Booking, wants follow-up | Trailing period on name. Summary `Uh, maybe a booking?`. Outcome `ask for that one slot only`. |
| `HD_af5d6344b42b` | Sep 10 03:35 | Alvin | Visit updated, Tuesday 10:00 AM | Summary `and, and Couch cleaning on Tuesday`. Intent live `general_enquiry`. Review `book_visit`. Also a VISIT UPDATED SMS. |
| `HD_16dd2b701133` | Sep 9 09:19 | Alvin | Couch cleaning Runda tomorrow 8:30 AM | Summary `I don't know if you reach there.` Intent `general_enquiry`. |
| `HD_60edbb89422b` | Sep 8 19:01 | Alvin | Mattress cleaning tomorrow 10 AM Rongai | Summary `Which cleaning service do I need?` Plus visit saved. |
| `HD_e8d4ee7283b5` | Sep 8 02:11 | Eve | Covers Kericho? | Lead SMS plus ENQUIRY SMS. Summary is account-update junk. |
| `HD_62feeb0ac3aa` | Sep 7 18:54 | Alvin | House cleaning Tuesday 2:00 PM Runda | Summary `Is there anything else I can help with?` |
| `HD_29b949b1e0f0` | Sep 6 10:33 | Alvin | Airbnb clean tomorrow 8:00 AM Runda | Closest to the bar. Intent `book_visit`. Summary still `To make a booking.` Plus VISIT REQUEST SMS. |
| `HD_c843f704f684` | Sep 5 09:52 | Alvin | Book couch cleaning | Outcome `The goal needs name`. |
| `HD_5549f551c4d4` | Sep 5 04:45 | Mr. Alvin Yegon | Mattress Runda tomorrow | Summary `Caller: Mr. Goal: Best.` |
| `HD_65d786c66f61` | Sep 4 03:01 | Alex | Carpet tomorrow 10:00 AM Barnabas | Intent `directions` (wrong). Reason already has the booking. |

**Excellence for `HD_3f7ed2a5f526` (one text, not two):**

```
New missed-call lead - Done and Dusted Cleaning Services
Name: Alvin
Phone: +254790381872
Reason: Alvin called to ask about roof cleaning services.
Intent: order_enquiry
Outcome: Enquiry saved
Open call: {desk}/calls/{id}
```

No Summary row unless it adds facts Reason does not already have.

### B. Escalation right, identity wrong

| SID | UTC | What happened | Gap |
| --- | --- | --- | --- |
| `HD_43492e7e296e` | Sep 7 18:35 | Medical emergency Ruaka, teammate Christopher Gachie | Name `Haijawekwa` (Swahili "not set"). Summary `Mm-hm.` Action was right. |
| `HD_ae71b5349f5e` | Sep 6 06:51 | Wants a human | Name `Callings` |
| `HD_0a8d5911d055` | Sep 6 06:38 | Wants a human | Name `Calling` (STT of "calling") |
| `HD_ea33941e0a5c` | Sep 9 13:54 | Chris wants Alvin | Reason good. Summary `Mkwe, nauliza Alvin ako wapi?` is usable if language matches the owner. |
| `HD_66412c77819e` | Sep 6 10:04 | Colin, complaint plus booking | Two jobs in one call. Escalation plus lead. Keep escalation; fold the booking into Reason. |
| `HD_3a84b29a00a7` `HD_c89e79a7e2ee` `HD_fc7589fc8a0e` `HD_4f14d4d55244` `HD_6f9424c1289a` | Sep 6 | Human / complaint tests | Duplicate human asks. Name Alvin is fine. Reason is thin (`wants to speak to a human`). |

**Excellence for the Ruaka emergency:**

```
Escalation for Christopher Gachie - Done and Dusted Cleaning Services
Caller: Caller
Phone: +254790381872
Reason: Dharura ya matibabu na uchungu wa tumbo huko Ruaka
```

Do not print `Haijawekwa`. Do not send a second lead SMS with that name.

### C. Correct non-sends (keep)

Sep 10 greeting-only and 10 to 30 second hangups (`HD_de6780ae0720`, `HD_0ae324d56f23`, `HD_e045de62934e`, `HD_7ef72820c4b5`, `HD_3fc0d4ba863a`, …) have no name. `whatsapp_sent` is false. That is the bar: do not text the owner for "How are you doing, Shy?"

`SMOKE_*` rows mark `whatsapp_sent` without a live SMS. Ignore them in audits.

### D. Production (ALCR)

No owner lead after 2026-08-14. Last useful ones still show the same Brain dump: `Goal: Uh, a birthday.`, product field `My name is Alvin`, name `Calling`, caller `Theexact` / `Where are you` / `Or the`. Closing the staging gap is the production gap.

---

## Why the payload is weak

1. **Send too early.** `maybeSendWhatsAppNotification` runs on `save_caller_info`. `owner_review` (PR #227) writes the good reason and intent after hangup. `whatsapp_sent` then blocks a better second send.
2. **`brain_summary` is a live snapshot.** `deriveCallSummary` stores the current goal, often the last STT fragment. It is not an owner sentence.
3. **Intent defaults to `general_enquiry`.** Review later sets `order_enquiry` / `book_visit` / `product_inquiry`. SMS already left.
4. **`resolution_note` is compiler speech.** `Visit request saved` is useful. `The response included a permitted end-call action` is not.
5. **Name gate is too wide.** `isPlausibleCallerName` accepts any 2 to 3 letter-words, so `Calling` and `Haijawekwa` pass. Trailing `.` also passed into SMS (`Alvin.`).
6. **One call, many kinds.** Lead does not suppress ENQUIRY / VISIT. Contract says one owner message per kind, which is how owners get two or three texts for one booking.
7. **No stored body.** Cannot diff "what TextSMS accepted" vs "what we meant" without reconstructing.

Gemini does not need database access. The row already has the better fields after review. The notify path must **wait for them or ignore the live dump**.

---

## How to tighten (exact)

### Ship now (this change)

Render-time hygiene in `ownerLeadEvent`:

- Strip trailing punctuation on names. Block `calling`, `callings`, `haijawekwa`, `caller`.
- Omit `Intent` when it is only `general_enquiry`. Prefer `owner_review.primary_intent` when present.
- Omit `Summary` when it is a greeting, backchannel, or a repeat of Reason.
- Omit `Outcome` when it is an internal Brain instruction.
- Persist `owner_notify_body` + channel on the call row after a successful send.

Skip the lead SMS entirely when the name is blocked. Still send escalation, with `Caller` instead of the garbage name.

### Next (Voice send timing)

Do not send the lead on mid-call `save_caller_info`. Send once on hangup, after `persistCallResolution` and `owner_review` (with a short timeout so a review miss still sends Name / Phone / Reason). That is the single largest close of the gap.

### Next (one text per call)

If a VISIT or ENQUIRY SMS already went out, do not also send `New missed-call lead` with the same facts. Or fold item / when into the lead and skip the second kind.

### Next (Brain)

Reject `Haijawekwa` / `Calling` at `save_caller_info`, not only at SMS. Confirm the name once (PR #234 is the start). Stop treating the last user turn as `goal` for `brain_summary`.

### Later (caller SMS)

Do not ship until owner payload hygiene and one-text-per-call are in. Then: owner toggle default off, `renderCallerText` only on visit/hold/callback, persist `caller_notify_body`, never send on enquiry/FAQ/emergency. Sender ID and Kenya STOP are still open product calls.

Set `DESK_PUBLIC_URL` on Railway so owner `Open call:` works. Production voice must run this notify path; staging-only hygiene will not fix ALCR.

---

## Scorecard (staging, Sep 6 to 10, sent rows)

| Check | Pass |
| --- | --- |
| Actionable calls notify | Pass |
| Greeting-only stays quiet | Pass |
| Reason usable without the desk | Mostly pass |
| Name is a person | Fail (~3 of 20) |
| Intent owner-grade | Fail (live field) |
| Summary owner-grade | Fail |
| Outcome owner-grade | Fail except visit/request saved |
| One SMS per call | Fail when visit/enquiry also fires |
| Caller confirmation | Not shipped. Templates exist. No send path. Correct silence until the toggle and triggers above exist. |
| Deep link | Unknown (env) |
