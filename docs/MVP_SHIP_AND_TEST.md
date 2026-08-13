# MVP: onboard → answer unanswered calls

**Product job (MVP):** When a business signs up and finishes onboarding, callers who would otherwise hit an unanswered line get a **live AI receptionist** that greets them, answers common questions from the business facts on file, takes a useful message / request when needed, and notifies the owner.

**North star (keep, but do not block MVP):** Move toward “resolves the caller’s job” (full-assist Brain — catalogue holds, deeper playbooks, learning loop). See `docs/BUSINESS_INTELLIGENCE_ROADMAP.md`. We do **not** forget that plan; we sequence it **after** the missed-call answer path is reliable.

**Beachhead:** Retail (ChapterOne Bookstore · DID `+254709221536` · Aisha) validates the path; onboarding must produce the same *kind* of readiness for new tenants.

---

## 1. MVP principle

> A newly onboarded business should efficiently handle the common 80% of **unanswered-line** calls: greet, understand, answer from knowledge, capture what the owner needs, escalate when asked — without inventing facts or claiming false success.

Reliability over breadth. Do not market workflows we cannot execute.

---

## 2. What “answers unanswered calls efficiently” means

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
| Language | en / sw / sheng match |

**Out of MVP claim (still on the long-term plan):** live transfer, calendar booking, POS sync, RAG, multi-vertical depth, “95% full assist.”

---

## 3. Onboard → answer path (required)

```text
Signup (DID + notify WA)
  → Onboarding wizard (vertical, offers, hours/location, tone)
  → Seed FAQs / policies / unknown line / hours_schedule / team catch-all
  → Compile llm_system_prompt
  → Line answers live calls
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

## 4. Automated gate

```bash
npm run test:mvp
```

Blocks ship when Brain/knowledge/MVP smokes fail.

---

## 5. Live DID pack (ChapterOne / new tenants)

Call the business DID. Log SID, pass/fail, class `K|U|A|P|V|O`.

| # | Say | Pass if |
| --- | --- | --- |
| 1 | “Are you open tomorrow?” | Correct hours; no forced name |
| 2 | “Where are you?” | Landmark/street correct; short |
| 3 | Listed product price (if catalogue) | Money only if on file; else admit |
| 4 | Genre with no stock (e.g. philosophy) | Admit none; no invent |
| 5 | Hold listed title + name + when | Hold saved; owner notified |
| 6 | Unlisted title order | Enquiry/quote — not clean order |
| 7 | “Speak to the manager” + real name | Escalate fires (not WhatsApp-only) |
| 8 | One Swahili then English turn | Sticky language |
| 9 | After-hours window | Honest closed + still help per mode |
| 10 | Clear goodbye | Natural end |

**GO:** `test:mvp` green + config gate + ≥8/10 live + zero trust breaks + at least one notify proof.  
**NO-GO:** repeated invented facts / false “saved/sent” / silent escalate miss.

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
