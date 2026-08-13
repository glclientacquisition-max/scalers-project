# MVP: onboard → answer unanswered calls

**Product job (MVP):** When a business signs up and finishes onboarding, callers who would otherwise hit an unanswered line get a **live AI receptionist** that greets them, answers common questions from the business facts on file, takes a useful message / request when needed, and notifies the owner.

**North star (keep, but do not block MVP):** Move toward “resolves the caller’s job” (full-assist Brain — catalogue holds, deeper playbooks, learning loop). See `docs/BUSINESS_INTELLIGENCE_ROADMAP.md`. We do **not** forget that plan; we sequence it **after** the missed-call answer path is reliable.

**Beachhead:** Retail (ChapterOne Bookstore · DID `+254709221536` · Aisha) validates the path; onboarding must produce the same *kind* of readiness for new tenants.

---

## 1. MVP principle

> A newly onboarded business should efficiently handle the common 80% of **unanswered-line** calls: greet, understand, answer from knowledge, capture what the owner needs, escalate when asked — without inventing facts or claiming false success.

Reliability over breadth. Do not market workflows we cannot execute.

---

## 2. Business assistant introduction (top-level)

How the line opens every unanswered call:

1. **Brand first** — business name in the first sentence  
2. **Agent named** — “this is {agent} speaking”  
3. **Offering (short)** — one grounded clause from services on file; never invent  
4. **English-default first open** — no random Kiswahili opener before the caller speaks (language match starts on their turn)  
5. **One invite** — “How can I help?” (or message/closed honesty)  
6. **Same line in Desk Test** — Settings → Test preview uses the same composer as live voice  

Example: *“Hello, you've reached ChapterOne Bookstore, this is Aisha speaking. We help with special orders / sourcing and delivery. How can I help?”*

Canonical modules: `src/conversation/businessAssistantIntro.js` (voice) and `dashboard/src/lib/businessAssistantIntro.ts` (Desk).

---

## 3. What “answers unanswered calls efficiently” means

| Caller need | MVP behavior |
| --- | --- |
| Someone called; owner busy / after hours / missed | AI answers the DID live (not voicemail-only) |
| Hours / open now | From structured schedule + bulletin |
| Where are you? | From locations / landmark |
| What do you offer / FAQ | From services + FAQs / policies |
| Price / stock (retail) | Only from catalogue when loaded; else admit + enquiry |
| Hold / order (retail) | Catalogue-grounded or enquiry — never fake |
| Leave a message / callback | Save + WhatsApp/email notify |
| Speak to a human | Async escalate (name required); never fake live transfer |
| Language | en / sw / sheng match **after** the caller speaks |

**Out of MVP claim (still on the long-term plan):** live transfer, calendar booking, POS sync, RAG, multi-vertical depth, “95% full assist.”

---

## 4. Onboard → answer path (required)

```text
Signup (DID + notify WA)
  → Onboarding wizard (vertical, offers, hours/location, tone)
  → Seed FAQs / policies / unknown line / hours_schedule / team catch-all
  → Compile llm_system_prompt
  → Line answers live calls (brand-first introduction)
  → Owner gets WA/email on message / hold / escalate
```

### Config gate after onboarding

- [ ] Real DID (not `pending:`)  
- [ ] Compiled prompt + agent name + tone  
- [ ] Hours text **and** structured `hours_schedule` when parseable  
- [ ] Location landmark / directions  
- [ ] Unknown-answer fallback  
- [ ] Notify: WhatsApp and/or alert email  
- [ ] Team catch-all (General queries) when escalate is on  
- [ ] Retail: upload product catalogue in Train ASAP (blank prices OK)  
- [ ] Recompile after Train edits  

Without a catalogue, retail still **answers** hours/location/FAQ/message — but must **not** invent prices or holds.

---

## 5. Automated gate

```bash
npm run test:mvp
```

Blocks ship when Brain/knowledge/MVP smokes fail.

---

## 6. Live DID pack (ChapterOne / new tenants)

Call the business DID. Log SID, pass/fail, class `K|U|A|P|V|O`.

| # | Say | Pass if |
| --- | --- | --- |
| 0 | *(listen to opener)* | Brand name + agent name in English; no Habari lottery |
| 1 | “Are you open tomorrow?” | Correct hours; no forced name |
| 2 | “Where are you?” | Landmark/street correct; short |
| 3 | Listed product price (if catalogue) | Money only if on file; else admit |
| 4 | Genre with no stock (e.g. philosophy) | Admit none; no invent |
| 5 | Hold listed title + name + when | Hold saved; owner notified |
| 6 | Unlisted title order | Enquiry/quote — not clean order |
| 7 | “Speak to the manager” + real name | Escalate fires (not WhatsApp-only) |
| 8 | One Swahili then English turn | Sticky language after caller speaks |
| 9 | After-hours window | Honest closed + still help per mode |
| 10 | Clear goodbye | Natural end |

**GO:** `test:mvp` green + config gate + ≥8/10 live + zero trust breaks + at least one notify proof.  
**NO-GO:** repeated invented facts / false “saved/sent” / silent escalate miss.

---

## 5b. Private beta GO (ChapterOne beachhead)

Private beta claim: **the DID answers**, FAQs work, verified message/enquiry/hold/escalate notify the owner — **never** invent stock/price or save garbage leads.

| Gate | Required |
| --- | --- |
| Voice | Greeting always heard; order/escalate hears a short progress line (no long dead air). Deploy includes voice dead-air fix `#141`. |
| Request integrity | No `order`/`hold` with STT sentences, missing catalogue, or agent/business as caller name (tool gates). |
| Live pack | Pass **1, 2, 6, 7, 9** every time; target ≥8/10 overall. |
| Notify | At least one real **SMS** (TextSMS) / WhatsApp / email from a saved enquiry or escalate. Private beta primary: `TEXTSMS_*` on Railway. |
| Trust | Zero false “Done — I've saved/sent” without a desk row. |

**Private beta NO-GO:** silent answer, garbled order rows (`I have to make habits`), caller_name = agent name, escalate claimed but not delivered.

**Out of private-beta claim:** perfect catalog sales, live transfer, pronunciation perfection, recording QA (nice-to-have; do not block if the five gates above pass).

Operator checklist before inviting testers:

1. Railway voice on latest `main` (confirm greeting + `action-progress` in logs).  
2. `npm run test:mvp` green.  
3. Run live pack rows 1–2, 5–7, 9; log SIDs.  
4. Confirm owner WhatsApp for one save.  
5. Invite testers with scripted FAQ + “leave a message” + “speak to manager” — not “stress-test every book title.”

---

## 6. Failure classes (observe → fix)

| Class | Meaning | Lane |
| --- | --- | --- |
| **K** | Knowledge missing/wrong | Desk / onboarding seed |
| **U** | Intent / name / language | Brain |
| **A** | Tool / notify failure | Brain tools |
| **P** | Wrong policy (escalate/promo) | Playbook |
| **V** | Barge / dead air | Voice |
| **O** | Bad summary / intent | Observability |

---

## 7. Sequencing vs the main plan

| Now (MVP) | Next (main plan, not forgotten) |
| --- | --- |
| Onboard → line answers missed calls | Deeper job resolution rate |
| Retail beachhead reliability | Home services / hospitality packs |
| Message + hold + escalate | Booking / CRM systems of record |
| Catalogue when trained | Learning loop FAQ gaps → Train |
| Async handoff | Live transfer when runtime exists |

Ship MVP when **onboarding produces a line that answers efficiently**. Grow toward full-assist without rewriting the spine (ground truth → Brain state → validated tools → confirmed outcomes).
