# Caller experience excellence (Brain)

**Status:** Research, not a ship claim. 2026-09-15.  
**Lane:** Brain. Voice and Desk appear only where they change what the caller or owner *hears or believes*.  
**Job:** Name the factors that make talking to the Business Assistant feel like a competent person at that business, and mark which of those we **have not achieved** on this platform.

Two clients, never mixed:

| Client | Who | What “good” is |
| --- | --- | --- |
| **Caller** | The business’s customer on the DID | Leave with an answer, a requested visit/hold, or an honest next step. Never feel interviewed or lied to. |
| **Owner** | The business that pays Scalers | The line represented their brand. The desk and SMS match what was promised on the phone. |

North star stays full assist (`docs/BUSINESS_INTELLIGENCE_ROADMAP.md`): complete the caller’s job from live ground truth. MVP is still unanswered-line reliability (`docs/MVP_SHIP_AND_TEST.md`). This note is the gap between those two for **conversation quality**.

Evidence: live SIDs in `LIVE_CALL_FINDINGS.md`, `CALL_MESSAGE_GAP.md`, home live pack, returning-caller spec, escalation vs live transfer. Repo tests are not the GO.

---

## What a good Kenyan receptionist already does

These are the bar. Code already *states* most of them. Live calls still miss several.

1. **One person.** Same named assistant the whole call. Not a form, not a second legal voice.
2. **Answer first.** Hours, price band, coverage, “do you do X” before any capture.
3. **One question.** Next missing fact only. Never a menu of slots.
4. **Match language and stay.** English opener. After they speak, en / sw / light Sheng. No Habari lottery.
5. **Finish the job.** Visit: service, name, when, landmark, then the tool. Retail: catalogue hold/order or honest enquiry.
6. **Honesty.** Unknown is valid. Closed is said, then help. Never invent price, ETA, coverage, or “I transferred you.”
7. **Trust of outcome.** The mouth does not say booked / moved / cancelled until the backend speaks. The owner later confirms.
8. **Memory without replay.** Known unique phone may skip re-asking the name. Shared line must not assume who is speaking.
9. **Repair like a person.** Mishear once, simplify once, then another path or a human. Hear-again repeats the *current* question, not the first one.
10. **Short speech.** About one sentence. No lists. No URLs. No playbook labels out loud.

Shipped enough to *aim* at this: intro composer, CALL STATE + NBA, visit/retail playbooks, language sticky patch, returning-caller card, backend-speaks tools, bounded repair, hear-again skip-save.

Not the same as *hearing* it on a live DID.

---

## Characters (this platform)

Each row is a real call shape we already see or designed for. Excellence is what they should experience. **Gap** is what still fails.

### 1. First-time visit booker (Mama Amina)

Calls Done and Dusted in Kiswahili. Wants a house clean. Has a landmark, not a street.

| Excellence | Gap |
| --- | --- |
| One missing slot at a time after the job is clear. Name once. Then when. Then landmark. Tool fires. Backend says the visit is *requested*. | Name re-ask and “is that right?” still stall the SOP on older prompts / unmerged runtime. Lists of couch/carpet/mattress still leak. |
| Stay in Kiswahili after `Nataka cleaning kesho`. Job nouns may stay English. | Sticky match is patched; live pack #13 is still the GO. Backend outcome lines and owner SMS are still English-first. |
| Does not hear “booked” then get a Sunday refuse. | Hours gate exists. Saying yes then no on the same window is still a live miss if the model speaks before the tool. |

### 2. Returning unique line (Alex, carpet last Tuesday)

Same phone. Contact row exists. Open visit or last reason on the card.

| Excellence | Gap |
| --- | --- |
| Instant greeting stays brand-first (latency). First *reasoned* turn uses the card: do not re-ask name; offer to move the open visit if that is why they called. | Card is injected. Instant TTS does **not** greet by name (by design). Many calls still sound like a first meeting because Gemini ignores RETURNING CALLER or last reason. |
| “Move my visit” updates the same row. | Playbook exists. Live pack #8 is not a CI gate. |

### 3. Shared homestead phone

Primary contact is Mama. Son calls from the same number. `alternate_names` set.

| Excellence | Gap |
| --- | --- |
| Ask who is speaking. Do not say “Hi Jane.” Do not attach the son’s visit to Mama’s name. | Spec and seed rules exist. Live confirmation of identity is thin. Wrong-name SMS (`Haijawekwa`, `Calling`) still poisons the file for the next call. |

### 4. Panic emergency (burst pipe)

Not “urgent Airbnb.” Water on the floor. Wants a human and an arrival time.

| Excellence | Gap |
| --- | --- |
| Name + reason, escalate, honest “I have notified the team.” No fake ETA. Urgent clean stays a visit. | Classification is shipped. Live transfer setting still does **not** ring anyone. Caller who said “connect me” can sit on a promise the runtime cannot keep. |

### 5. After-hours / bulletin closed (Sunday 21:00)

Wants tomorrow morning. Line still answers.

| Excellence | Gap |
| --- | --- |
| Honest closed. Still take the visit for an open window, or a callback if mode is message-only. No same-day fiction. | Serve vs message is in CONTEXT HEADER. Mixed “office vs site” hours (hotel 05:00, desk 08:00) still confuse. Promo bulletins can still volunteer off-topic if compile is stale. |

### 6. Human-seeker (“Connect me to Alvin”)

Owner enabled Connect live call. Dest may be the same phone as the tester.

| Excellence | Gap |
| --- | --- |
| If Dial is actually live: stay on the line, human rings. If not: name, notify, honest SMS/desk confirm. Never dead air after “stay on the line.” | Live Dial is specified, not shipped (`LIVE_TRANSFER.md`). WS-close spike left dead air (`HD_0a8d5911d055`). NBA must stay ESCALATE until Voice sets `liveTransfer: true`. |

### 7. Retail hold (ChapterOne, a named title)

Wants a price, then “hold it until 5.”

| Excellence | Gap |
| --- | --- |
| Price from catalogue. Hold only on a grounded title. Pickup time refines the same hold. Unlisted title becomes enquiry, not a fake hold. | Tools and playbook exist. Blank catalogue still forces unknown + enquiry. Genre asks must not recommend Sample from another shelf (rule exists; empty TARGETED still needs live proof). |

### 8. Out of coverage (Kericho)

| Excellence | Gap |
| --- | --- |
| Decline or note a callback. No promised visit off-map. | Only as good as POLICIES / LOCATIONS the owner typed. Empty coverage reads as “we can come.” |

### 9. Phatic tester (Alvin: “How are you doing, Shy?”)

Owner or friend calling the DID.

| Excellence | Gap |
| --- | --- |
| One short well, then help. No service list. No idle “Are you still there?” before they have spoken. | Live leftover: *I'm doing well, thank you!* plus couch/carpet/mattress (`LIVE_CALL_FINDINGS`). Idle nudge is Voice; the list is Brain. Testers abandon here. |

### 10. Noisy line / hear-again (“Pardon?”)

Matatu, speakerphone, barge-in.

| Excellence | Gap |
| --- | --- |
| Repeat the **current** missing slot, clearer, shorter. Not a name loop. Not “booking complete.” | Hear-again skip-save is shipped. Repeating the wrong question and treating `Pardon?` as a name were live misses. Barge `Wait.` still burns Gemini if Voice lets it through. |

### 11. Mixed / Sheng youth

`Sawa`, then English job nouns, then Kiswahili when.

| Excellence | Gap |
| --- | --- |
| Light Sheng, sparse. Do not flip to English because `cleaning` appeared. Do not stack slang. | Job-loanword sticky match shipped. Sheng as a full stay-language is still thin. One `sawa` must not switch (by design) and still feels deaf if the rest of the turn was Kiswahili. |

### 12. Owner as Scalers client

Never on the DID. Judges the assistant by Inbox + SMS.

| Excellence | Gap |
| --- | --- |
| One visit notify: real name, job, when, place, CTA Visits. No mid-call lead dump while booking. Caller SMS only if they opted in, in the caller’s language, after a real save. | Owner SMS still a Brain-field dump before hangup review (`CALL_MESSAGE_GAP.md`). Fake names. Intent stuck `general_enquiry`. Caller SMS default off, English templates, shortcode sender. Dual messages (lead + visit) on one call. |

---

## Factors not yet achieved (stack, not slogans)

Ranked by how much they break trust on a live Kenyan call. Each is a **conversation** failure even when the table row saved.

### F1. The call still sounds like a slot machine

**Bar:** Hear the ask. Collect only what is missing. Sound like one receptionist.

**Not yet:** Gemini still recites lists, confirms names as a detour, and re-asks filled slots when CALL STATE and the compiled `llm_system_prompt` disagree (invariant 11: stale compile fights runtime). Visit SOP in the playbook is not the same as the mouth following it.

**Lane:** Brain (prompt + state). Recompile after every policy change. Live pack #5–6.

### F2. Outcome language vs owner truth

**Bar:** Caller hears *requested* / *noted for the team*. Owner confirms in Inbox. Optional caller SMS after confirm, in their language.

**Not yet:** Callers hang up believing it is booked. Caller SMS is off and would often be English. Owner text is a label dump, not the sentence they would tell a colleague. Same-hour visits are allowed; the caller may still hear exclusivity.

**Lane:** Brain copy + notify payload (with Voice send path). `CALL_MESSAGE_CONTRACT.md`.

### F3. Identity is still noisy

**Bar:** One real person name on file. Shared lines confirmed. Notify never sends `Calling` / `Haijawekwa`.

**Not yet:** STT fragments become names. Returning card then teaches the next call the wrong person. Spelling assist helps; it does not replace a once-and-done capture that refuses junk.

**Lane:** Brain extract + post-call name extract. Desk notify display gate already exists; the phone must not write garbage in.

### F4. Language stay is not the whole Kiswahili product

**Bar:** After the first Kiswahili turn, questions, hours, closed lines, and tool outcomes stay Kiswahili until they switch.

**Not yet:** Invite on open is shipped. Match on job-noun turns is shipped. Outcome speech, repair, escalate confirm, and SMS are still English-shaped. Sheng is “light” in rules, not proven live.

**Lane:** Brain. Live pack #13 plus SW backend lines.

### F5. Returning caller is a file, not a relationship

**Bar:** Unique line: skip name, recognize open visit, reschedule without a new book. Shared line: who is this.

**Not yet:** Greeting cannot wait on Gemini (correct). First Gemini turn often ignores the card. No spoken “welcome back” that is short and local. No eval that the *spoken* path uses last reason.

**Lane:** Brain prompt + evals (`eval:brain` scores card shape, not live mouth).

### F6. Human handoff honesty

**Bar:** Settings that say live connect only speak connect when Dial runs. Otherwise notify and say so.

**Not yet:** Owner can set live transfer. Runtime cannot Dial after Stream. Dead air is worse than SMS. Escalation still asks name even when the card already has one (if F1/F5 fail).

**Lane:** Voice for Dial. Brain must not claim transfer until the flag is true.

### F7. Phatic and pitch

**Bar:** “How are you?” gets one clause, then help. Never a catalogue recitation on a greeting.

**Not yet:** Documented live leftover. 25-word / no-lists rule is in `CONVERSATION_RULES` and still leaks.

**Lane:** Brain prompt + maybe a spoken-line filter (careful: Voice owns TTS). Ban lists in post-filter if the model emits them.

### F8. Knowledge emptiness sounds like competence

**Bar:** Empty coverage, empty price, empty policy: admit, one authorized next step. Do not force a name.

**Not yet:** Onboarding can leave Train thin. The assistant then sounds sure or interrogates. Learning loop (unknown → owner approve → recompile) is roadmap, not product.

**Lane:** Brain unknown fallback + Desk Train. Not a new vertical.

### F9. Two clocks, one mouth

**Bar:** “Are you open?” matches how that business actually serves (site vs office vs visit window).

**Not yet:** Structured hours vs prose location hours (Ngong Hills hotel finding). Home visits use hours as a persist gate; the spoken story can still contradict.

**Lane:** Brain hours semantics + owner Train. No invented calendar.

### F10. Dual-client consistency

**Bar:** Caller, transcript, Inbox, owner SMS tell the same story.

**Not yet:** Mid-call `save_caller_info` SMS vs hangup review. Instant summary from STT. Prompt hash not on the call (cannot debug which compile spoke).

**Lane:** Brain summary + Platform snapshot. Voice send timing.

### F11. Outage CX

**Bar:** Speech down: short clip, call back. Reasoning down: keep the line, take a name, do not fake a booking.

**Not yet:** The names-only path is a lifeboat, not a receptionist. Callers who were mid-SOP get a different person. No spoken apology that matches the previous turn.

**Lane:** Brain copy on the existing Voice outage path. Do not invent bookings.

---

## Explicitly not the bar (this quarter)

Do not use CX research to justify these as Brain tickets:

- Google Calendar, capacity UI, hospitality rooms
- Mid-call RAG / transcript dump into Gemini
- Default-on caller SMS before name and language gates
- Live Dial until Voice has a proven ring
- Per-niche chemicals, ETAs, crew size
- A second conversation UI for the same call data

---

## How to use this

One character, one factor, one PR. Suggested Brain sequence (Voice/Desk called out):

1. **F1 + Amina:** live DID pack #5–6 and #13 after name-SOP / compile. Prove the mouth follows CALL STATE.
2. **F7:** strip service lists and phatic padding on greeting-like turns.
3. **F3:** refuse junk names into contacts and notify.
4. **F4:** Kiswahili outcome lines for visit requested / closed / escalate confirm.
5. **F5:** first Gemini turn must act on RETURNING CALLER (reschedule vs new visit).
6. **F2 + F10:** owner SMS from hangup review; caller SMS still opt-in.
7. **F6:** Brain speech stays escalate-honest until `liveTransfer: true`.
8. **F8 / F9:** Train emptiness and hours semantics, not new playbooks.

GO remains the live DID pack in `HOME_SERVICES_MVP_BAR.md` and retail MVP pack. This document does not replace them.
