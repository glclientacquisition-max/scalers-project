# MVP ship & test — retail beachhead

**Status:** Ready to gate ChapterOne (and similar retail) as the first real-business beta  
**Principle:** Reliability over breadth — claim only what we can understand, ground, execute, verify, recover, and observe.

Beachhead tenant today: **ChapterOne Bookstore** · DID `+254709221536` · agent **Aisha** · vertical **retail**.

---

## 1. What we claim in MVP

| Capability | Must work | Graceful failure |
| --- | --- | --- |
| Greet + short turns | Yes | — |
| Hours / open-closed | Structured schedule + bulletin honesty | Admit if schedule missing |
| Location / directions | From locations on file | Ask branch if multiple |
| FAQ / policy from file | Answer only what’s on file | Admit unknown; no invented policy |
| Price / stock | Only from catalogue concrete fields | Unknown price → admit + quote/enquiry |
| Product / genre ask | TARGETED matches only | CATEGORY MISS → admit none listed |
| Hold for pickup | Catalogue title + name + when | Unlisted title → enquiry, not hold |
| Order intent | Catalogue title + name | Unlisted/garbled → enquiry/quote |
| Enquiry / message | Save request + notify when configured | Soft-fail honestly |
| Escalate (async) | Name required; WA/email or desk note | Never claim live transfer |
| After-hours | Per `after_hours_mode` | Honesty first |
| Language | en / sw / sheng sticky | Switch on strong evidence |
| End call | Natural goodbye + optional end_call | — |

### Explicitly out of MVP claim

- Live call transfer  
- Calendar / room / appointment booking as a completed job  
- Invented recommendations outside TARGETED catalogue matches  
- Guaranteed delivery times or payment completion  
- “We support every caller request” marketing  

---

## 2. Pre-ship config gate (tenant)

Before marking a tenant “MVP live,” confirm in Desk Settings (save + **recompile**):

- [ ] Identity: business name, agent name, tone  
- [ ] Hours schedule matches reality (EAT)  
- [ ] At least one location with landmark/directions  
- [ ] Unknown-answer fallback line set  
- [ ] Notify channel: WhatsApp and/or alert email  
- [ ] Team directory has a catch-all (e.g. General queries / owner)  
- [ ] `agent_tools`: escalate + end_call as intended  
- [ ] Retail: product catalogue loaded; empty prices left blank (never fake)  
- [ ] Active bulletin only if true today; promo not required for MVP  
- [ ] Pronunciation lexicon for brand + street names (ChapterOne checklist)  
- [ ] Billing: beta enforcement off unless intentionally charging  

---

## 3. Automated gate (CI / pre-deploy)

```bash
npm run test:mvp
```

Runs Brain + knowledge unit suites, then:

- `smoke:retail` — playbook classify/slots  
- `smoke:escalation` — team routing  
- `smoke:mvp` — end-to-end Brain scenarios (intent → NBA → tools → summary)

No live DID required. Failures block ship.

---

## 4. Live DID test pack (ChapterOne)

Call `+254709221536`. Log SID, pass/fail, failure class (`K|U|A|P|V|O`).

| # | Say | Expect | Pass if |
| --- | --- | --- | --- |
| 1 | “Are you open tomorrow?” | Hours from schedule | Correct open/closed; no name ask |
| 2 | “Where are you?” | Directions | Landmark/street correct; short |
| 3 | “How much is Rich Dad Poor Dad?” (or a listed title) | Price or unknown | Money only if catalogue has price; else admit unknown |
| 4 | “Recommend a philosophy book” | No cross-genre invent | Admits none listed / no Finance titles invented |
| 5 | “Hold [listed title] for me tomorrow at 5, my name is [Name]” | Hold saved | Confirmation after tool; desk shows hold |
| 6 | “Order Atomic Habits, my name is [Name]” (if not in catalogue) | Enquiry path | No clean order on missing title |
| 7 | “I want to speak to the manager” → give real name | Escalate fires | Team notified or soft desk note; not WhatsApp-only without escalate |
| 8 | Mix: one Swahili turn then English | Sticky language | No random re-greet / language flip |
| 9 | After hours (if testing closed window) | Bulletin/closed honesty | Still helps per after-hours mode |
| 10 | Clear goodbye | End naturally | Optional end_call; no loop |

### Desk checks after each call

- Transcript readable  
- `primary_intent` sensible (not stuck `general_enquiry` after manager ask)  
- Summary does not use STT fragments as caller name  
- Tool outcomes visible (hold / escalate / enquiry)  
- Resolution not silently `unknown` when job completed  

---

## 5. Failure classes (every fail)

| Class | Meaning | Typical fix lane |
| --- | --- | --- |
| **K** | Knowledge / ground truth wrong or missing | Desk config + live ground truth |
| **U** | Intent / entity / language misunderstanding | Brain state / extraction |
| **A** | Tool missing, false success, no notify | toolExecution / escalate inject |
| **P** | Wrong policy (escalate too soon, promo volunteered) | Playbook / NBA |
| **V** | Barge, dead air, mid-sentence cut | Voice |
| **O** | Bad summary / intent / missing traces | callSummary / observability |

Loop: **observe → classify → one fix → regression test → deploy → retest same #**.

---

## 6. Go / no-go

**GO** if:

1. `npm run test:mvp` green on the deploy revision  
2. Config gate complete for the beachhead tenant  
3. Live pack: **≥ 8/10 pass**, and **zero** trust breaks (invented price/hours, false “saved/sent”, silent escalate miss)  
4. Owner notify path proven on at least one hold or escalate  

**NO-GO** if any trust break repeats on a second attempt after config fix.

---

## 7. After GO

- Keep capability freeze until ChapterOne week is boringly reliable  
- Queue only fixes from live failure classes  
- Do not expand to booking / new verticals until MVP pack stays green  
