# Scalers Business Assistant language system

**Status:** Phase 7 of Frontend 2.0. Language and owner-facing copy.  
**Date:** 2026-09-02  
**Lane:** Desk UI/UX  
**Authority:** [`FRONTEND_CONSTITUTION.md`](./FRONTEND_CONSTITUTION.md), [`CUSTOMER_WORK_MODEL.md`](./CUSTOMER_WORK_MODEL.md), [`RECEPTIONIST_UX_MODEL.md`](./RECEPTIONIST_UX_MODEL.md), [`NAVIGATION_RESEARCH.md`](./NAVIGATION_RESEARCH.md), [`pages/settings.md`](./design-system/pages/settings.md), [`pages/receptionist.md`](./design-system/pages/receptionist.md)  
**Does not authorize:** schema, Brain compile semantics, new routes, new nav items, TenantForm split, capability engine, workflow builder, live transfer, new packages.

This document is the owner-facing language contract for Scalers. Phase 6D remains the **architecture** of knowledge, policy, capability, and work. This phase changes how that architecture is **named** for owners.

---

## 1. Executive summary

Scalers is a **Business Assistant** for Kenyan SMEs.

The assistant handles the business's customer-facing conversations (voice first). It answers from what the owner taught it, captures unfinished customer work, and escalates when a human is needed.

**Receptionist** is too narrow. A plumber's line is not a front desk. A shop's line is not a salon booking clerk. Receptionist remains a **possible spoken role and a possible default name**, not the product.

**Train** stays as Settings IA. It means teach the assistant about the business, not fine-tune a model.

**Test** stays as Settings IA. It means try the assistant before customers do.

Allowed line states stay **Line live / Number pending / Needs training**. No Online. No AI orb. No seventh nav item.

Implementation in this phase is **copy and a few panel titles** on existing surfaces. No IA restructure.

---

## 2. Product mental model

```text
                    BUSINESS
                       │
                       ↓
                BUSINESS ASSISTANT
                       │
             ┌─────────┼─────────┐
             ↓         ↓         ↓
         Knowledge   Policy   Capabilities
             │         │         │
             └─────────┼─────────┘
                       ↓
              Customer conversations
                       │
              ┌────────┴────────┐
              ↓                 ↓
           Answers          Customer Work
                                │
                       ┌────────┴────────┐
                       ↓                 ↓
                   Request          Scheduled work
                       │                 │
                       └────────┬────────┘
                                ↓
                           Owner action
```

The UI does not draw this diagram. The owner should simply feel:

> My assistant knows my business, handles customer conversations, and brings me the things that still need me.

Home answers **what needs me**. Calls answers **what happened**. Requests and Appointments are **unfinished work** (unscheduled vs scheduled). Business is **where I prepare the assistant**.

---

## 3. Why Business Assistant replaces Receptionist

| Receptionist as product | Problem |
| --- | --- |
| Implies a front desk | Home services, wholesale, and professional firms do not think that way |
| Sounds like one job | The assistant also answers catalog, captures orders, and leaves work |
| Collides with the default spoken name | `agent_name` default `Receptionist` is a **person name on the line**, not the product |
| Pushes AI-receptionist marketing | Constitution already forbids configuring an AI toy. "AI receptionist" still sounds like a category of chatbot |

Phase 6D asked owners to "train my receptionist." That was the right *relationship* (teach a working teammate) and the wrong *job title* for every vertical.

Landing already said "business assistant" but also **"autonomous"**, which over-claims. This phase drops autonomy language. The assistant is not an AI employee.

---

## 4. Business Assistant definition

**Business Assistant:** a system that handles the business's customer conversations and leaves the owner the work that still needs a human.

It may:

- answer questions from business information
- capture a request, callback, hold, or order note
- capture a requested time where scheduling is supported
- notify a teammate when the caller needs a person now

It does not:

- run the business
- confirm a live diary it does not have
- transfer a live call unless Voice later ships an executor
- train or fine-tune a model when the owner taps Save

Spoken identity remains `agent_name` (often a human first name). The product around that person is the assistant.

---

## 5. Receptionist as a behavioral role

Keep **Receptionist** when it is:

| Use | Keep? |
| --- | --- |
| Default spoken name if the owner never renamed the assistant | Yes. Compile/voice fallback. Not a product title |
| Tone guidance inside compiled prompts ("like a Kenyan receptionist") | Yes for Brain. Owner UI does not show those strings |
| Pronunciation skip-list / regex `/^receptionist$/i` | Yes. Internal |
| A salon owner naming their assistant Receptionist | Yes. That is their choice |

Drop **Receptionist** when it is:

- the name of the product
- a Settings panel title
- a Home CTA
- a transcript speaker label (use Assistant, or the actual `agent_name` later)
- marketing ("AI receptionist")

A salon assistant can *behave* like a receptionist. A plumber's assistant behaves like a coordinator. The product word stays Assistant.

---

## 6. Knowledge language

Owner words for facts the assistant may say:

| Prefer | Avoid |
| --- | --- |
| Business information | Knowledge base, context, embeddings |
| Hours | Operating hours schema |
| Location | Coverage polygon |
| Services / Products | Catalog ontology (Catalog as a **tab** stays) |
| FAQs | Golden FAQs in chrome |
| Updates | Bulletin, daily digest |

**Catalog** and **Updates** stay as tab titles. They are established and concrete.

**Import knowledge** is the one owner heading that still says knowledge. Change to **Add business information**.

---

## 7. Policy language

Owner words for rules:

| Prefer | Avoid |
| --- | --- |
| Policies | Guardrails, system policy |
| After hours | After-hours mode (keep the control, mute the schema name in chrome if a heading says "mode") |
| When a human is needed | Handoff, routing, live transfer as a promise |

`handoff_mode` stays a field. Owner heading: **When a human is needed**. Option labels stay concrete: WhatsApp / email callback; Live transfer (when available).

---

## 8. Capability language

Do not show a capability matrix.

| Internal (keep in code) | Owner |
| --- | --- |
| `answer_information` | (invisible; they taught hours/FAQs) |
| `create_service_request` | (invisible; Requests appear when a promise remains) |
| `create_appointment` | (invisible; Appointments appear when a time was requested) |
| `escalate` | Alert a teammate (already) |
| `end_call` | Hang up after goodbye (already) |

Tools & voice stays as a Train panel. It already uses action language, not "capabilities."

---

## 9. Train language

**Train** remains the non-clickable Settings section header.

Meaning:

> Teach your assistant about your business.

Not:

> Train the AI model.

Save CTA already: **Save & train assistant**. Keep. "Train" here is the established verb for teaching, not fine-tuning. Flash copy must not say "basic mode" (Gemini vs local compile leak).

Panel titles:

| Current | Recommendation |
| --- | --- |
| Agent Persona | **Assistant** |
| Hours | Keep |
| Locations | Keep |
| Policies | Keep |
| Escalation Team | **Team** |
| FAQs | Keep |
| Tools & voice | Keep |
| Pronunciation | Keep |

Do not add an instructional sub-header under Train. The panel names are the explanation.

---

## 10. Test language

Title stays **Test**.

Do not add a tutorial sentence under the heading (constitution: no instructional sub-headers).

Change the identity link from Agent Persona to Assistant.

Change "agent name" to "assistant name" in the empty preview line.

Primary action stays **Play phone preview** and the live number. Do not invent "Call your assistant" as a button if the surface is still `tel:` to the DID.

---

## 11. Readiness language

Keep `assessMvpAnswerReadiness()`. Never show `score`.

Owner states:

```text
Line live
Number pending
Needs training
```

Home already shows the first required gap id via `trainingGapLabel`. Replace implementation words:

| Gap id | Current gap label | Owner gap label |
| --- | --- | --- |
| `did` | Number | Number |
| `prompt` | Prompt | Finish setup |
| `identity` | Agent | Assistant name |
| `hours` | Hours | Add hours |
| `location` | Location | Add location |
| `faqs_or_fallback` | FAQs | Add FAQs |
| `notify` | Notify | Add notify |

Helper `label` strings inside `mvpAnswerReadiness.ts` are not currently rendered on Home. Still retitle "Receptionist prompt compiled" so a future list cannot leak it.

---

## 12. Home language

Home stays the Command Center. Not an assistant profile.

Keep: New call leads, Calls today, Followed up, Line, one primary CTA.

CTA map:

| Situation | Current | Proposed |
| --- | --- | --- |
| New leads | Process leads | Keep |
| Number pending | Test receptionist | **Test assistant** |
| Training gap | Train receptionist | **Teach assistant** |
| Wallet low | Add credit | Keep |
| Zero calls | Test receptionist | **Test assistant** |
| Default | Show all calls | Keep |

When the line is live and there is no training gap, one short line is allowed:

> Your assistant can take calls.

No avatar. No waveform. No Online.

---

## 13. Calls language

Calls stay the conversation workplace.

Empty state **Train assistant** → **Teach assistant** (same destination, consistent verb).

**How to test** stays.

Transcript speaker **Receptionist** → **Assistant**. Do not interpolate `agent_name` in this phase (layout risk; deferred).

Do not redesign the inbox.

---

## 14. Requests language

Keep the route, tab, and word **Request**.

Phase 6C: unscheduled customer work. No copy rewrite of the list in this phase except removing receptionist if any remains (none in the current empty state).

---

## 15. Appointments language

Keep the route and word **Appointment**.

Scheduled work. Display aliases (Visit, Booking, Reservation) stay deferred. Do not build a terminology engine.

---

## 16. Business settings language

IA stays:

```text
Updates · Catalog · Train · Import · Test
```

Job of the page: prepare and manage the Business Assistant.

Business header stays **Business**. Line number stays. No assistant hero.

Import heading **Import knowledge** → **Add business information**.

---

## 17. Vertical terminology

Packs stay `retail | home_services | hospitality | general`.

Owner labels already concrete (Retail / shop, Home services, Hotel / lodge / restaurant, Other / general).

Only blurb change: **General receptionist** → **General business**. Blurbs are not currently shown on onboarding chips; still fix the string.

Do not add health, education, finance packs.

Do not put long vertical marketing into the UI.

---

## 18. Multilingual language

No picker. No "configure languages" step.

Owners do not need a sentence about English / Kiswahili / Sheng unless they ask. Test and Train do not add a languages panel.

Internal: `languageOptions.js` remains automatic.

---

## 19. Copy rules

Calm, direct, specific, operational, Kenyan-business appropriate.

- Prefer verbs: Teach, Test, Add, Follow up, Save.
- One idea per heading.
- No em dashes in UI.
- No instructional sub-headers.
- No "your AI is thinking."
- No "autonomous," "AI employee," "digital worker."
- No "prompt," "model," "LLM," "workflow," "agent" in owner chrome.

---

## 20. CTA rules

| Rank | Examples |
| --- | --- |
| Primary (`#0096FF`) | Save & train assistant, Process leads, Play phone preview, Teach assistant, Test assistant |
| Secondary | How to test, Show all calls, Back |
| Destructive / mute | Cancel, Remove |

Do not create a second primary on a screen.

WhatsApp: blue button, green glyph only.

---

## 21. Terms to avoid (owner UI)

```text
AI receptionist
AI agent
AI employee
autonomous
bot
prompt
system prompt
model
LLM
workflow
capability matrix
knowledge ingestion
context injection
inference
deploy your agent
supercharge
unlock automation
Online
AI active
```

**Handoff** as a heading. **Agent Persona.** **Prompt** as a readiness gap.

---

## 22. Terms to preserve

```text
Train          (Settings section)
Test           (Settings tab)
Catalog
Updates
Import
Business
Calls
Requests
Appointments
Line live
Number pending
Needs training
Save
Assistant      (product role)
```

Internal symbols: `agent_name`, `compileReceptionistPrompt`, `TestLinePanel`, `assessMvpAnswerReadiness`, `TenantForm`.

---

## 23. Internal code terminology

| Symbol | Action |
| --- | --- |
| `compileReceptionistPrompt` | Keep. Brain/compile API |
| `PROMPT_COMPILER_SYSTEM` "phone AI receptionist" | Keep. Changing it changes live prompts (Brain) |
| `defaultTenantLlmPrompt` "live phone receptionist" | Keep. Signup/SQL mirror |
| `agent_name` default `"Receptionist"` | Keep. Spoken fallback |
| `/^receptionist$/i` in pronunciation | Keep. Skip generic name |
| `extract.ts` / FAQ Gemini system strings | Keep. Not owner UI |
| `AdminVoicesManager` placeholder | Keep. Ops surface |
| `businessAssistantIntro.ts` | Keep. Already the spoken intro helper |

---

## 24. Exact proposed changes

Owner-facing only. See also the copy audit in §29 of the Phase 7 brief (expanded below).

| Current | Proposed | File | Why |
| --- | --- | --- | --- |
| Test receptionist | Test assistant | `commandCenter.ts` | Product role |
| Train receptionist | Teach assistant | `commandCenter.ts` | Teach, not fine-tune; Train stays IA |
| gap Prompt | Finish setup | `commandCenter.ts` | No prompt in chrome |
| gap Agent | Assistant name | `commandCenter.ts` | No agent |
| Agent Persona | Assistant | `BusinessSettingsShell.tsx`, `TestLinePanel.tsx` | Identity panel |
| Escalation Team | Team | `BusinessSettingsShell.tsx` | Owner word |
| Agent name | Assistant name | `TenantForm.tsx` | Product role |
| Training complete. Your receptionist… | Saved. Your assistant will use this on the next call. | `TenantForm.tsx` | One flash; no "basic mode" |
| Training saved (basic mode)… | (same single flash) | `TenantForm.tsx` | Hide compile source |
| Handoff (heading) | When a human is needed | `TenantForm.tsx` | Match onboarding |
| AI stays on the line | The assistant stays on the line | `handoffMode.ts` | No AI |
| Add to my receptionist | Add to my assistant | `KnowledgeIngestPanel.tsx` | Product role |
| Import knowledge | Add business information | `KnowledgeIngestPanel.tsx` | Owner word |
| What the receptionist should say | What the assistant should say | `CallFaqSuggestions.tsx` | Product role |
| Receptionist (transcript) | Assistant | `calls/[id]/page.tsx` | Speaker |
| Train assistant (empty calls) | Teach assistant | `calls/page.tsx` | Align with Home |
| Receptionist name & tone | Assistant name & tone | `OnboardingWizard.tsx` | Product role |
| Receptionist name | Assistant name | `OnboardingWizard.tsx` | Product role |
| placeholder Receptionist | e.g. Aisha | `OnboardingWizard.tsx` | Match Train; default value still Receptionist |
| Tone & handoff (step) | Name & tone | `OnboardingWizard.tsx` | Drop handoff as IA word |
| like a receptionist people enjoy… | (unused blurb) Warm and helpful. | `OnboardingWizard.tsx` | Dead copy cleanup |
| Could not build a receptionist prompt | Could not finish assistant setup. Try again. | `onboarding/actions.ts` | No prompt |
| General receptionist | General business | `vertical.ts` | Pack blurb |
| Receptionist prompt compiled | Assistant setup | `mvpAnswerReadiness.ts` | No prompt |
| reach the receptionist | reach your assistant | `mvpAnswerReadiness.ts` | Product role |
| The autonomous business assistant… | The business assistant for Kenyan SMEs. | `LandingPage.tsx` | No autonomy claim |
| Autonomous business assistant… (metadata) | Business assistant for Kenyan SMEs. | `layout.tsx` | Same |
| agent name (Test empty) | assistant name | `TestLinePanel.tsx` | Product role |
| How the receptionist says their own name | How the assistant says their own name | `pronunciationSuggest.ts` | Shown as a practice reason |

Home, when line live and no gap: add **Your assistant can take calls.**

---

## 25. Deferred terminology changes

| Item | Why deferred |
| --- | --- |
| Rename `compileReceptionistPrompt` | Brain/compile risk |
| Change compiled prompt "live phone receptionist" | Changes live voice identity for every tenant |
| Default `agent_name` away from Receptionist | Changes spoken greeting for new tenants without an owner choice |
| Transcript uses live `agent_name` | Layout + mixed historical rows |
| Appointment → Visit/Booking by pack | Terminology engine; 6C deferred |
| Rename Train | Established IA; teach via CTAs instead |
| Languages sentence on Test | No picker; avoid extra chrome |
| Pronunciation "AI listen" | Paid Gemini cost disclosure; not product positioning |
| Constitution-adjacent Brain docs | Separate Brain PR |
| Split TenantForm | Not required |
| Seventh Assistant nav item | Forbidden |

---

## 26. Phase 8 opportunities

1. Page-spec empty states that name Hold / Visit / Reservation without a terminology engine (6C leftover).
2. Home mix of open work (still product-gated).
3. Optional spoken name in the transcript speaker chip.
4. Brain: compiled identity "business assistant" vs "receptionist" if product wants the line itself to stop saying receptionist. **Not Desk.**
5. Hospitality playbook (Brain).
6. Constitution already updated in this phase for owner language; do not fork it per page.

**Phase 8 readiness:** READY for copy-on-existing-lists and optional transcript speaker name. BLOCKED for Brain prompt identity change, schema, and nav.

---

## Required terminology matrix (expanded)

| Concept | Current wording | Recommendation | Reason |
| --- | --- | --- | --- |
| Product role | Receptionist / AI receptionist | Business Assistant | Broader than a front desk |
| Test CTA | Test receptionist | Test assistant | Natural |
| Training CTA | Train receptionist | Teach assistant | Avoid model-training implication; Train stays IA |
| Knowledge heading | Import knowledge | Add business information | Owner language |
| Capability | (not shown) | Keep hidden; action labels only | No matrix |
| Handoff heading | Handoff | When a human is needed | Understandable |
| Request | Request | Preserve | Established work view |
| Appointment | Appointment | Preserve route | Scheduled work |
| Agent Persona | Agent Persona | Assistant | Less technical |
| Agent name | Agent name | Assistant name | Product role |
| Escalation Team | Escalation Team | Team | Less jargon |
| Workflow | (rare) | Avoid | Not the product |
| Prompt | Prompt / receptionist prompt | Finish setup / assistant setup | Technical |
| Model | (compile internals) | Avoid in owner UI | Technical |
| Autonomous | Landing + metadata | Drop | Over-claims |
| AI | Handoff blurb | Assistant | Technical |
| Transcript speaker | Receptionist | Assistant | Product role |
| Save | Save & train assistant | Preserve | Already assistant language |

---

## Copy audit (owner-facing)

Format: Current → Proposed → Why → File.

### Home

- `Test receptionist` → `Test assistant` → Product role → `commandCenter.ts`
- `Train receptionist` → `Teach assistant` → Teach not fine-tune → `commandCenter.ts`
- `Prompt` → `Finish setup` → No prompt leak → `commandCenter.ts`
- `Agent` → `Assistant name` → No agent → `commandCenter.ts`
- (new, live + ready) → `Your assistant can take calls.` → Contextual assistant, not a hero → `home/page.tsx`

### Business / Train / Test / Import

- `Agent Persona` → `Assistant` → Identity → `BusinessSettingsShell.tsx`
- `Escalation Team` → `Team` → Jargon → `BusinessSettingsShell.tsx`
- `Agent name` → `Assistant name` → Identity → `TenantForm.tsx`
- `Handoff` → `When a human is needed` → Match onboarding → `TenantForm.tsx`
- `Training complete. Your receptionist will use this on the next call.` → `Saved. Your assistant will use this on the next call.` → One honest flash → `TenantForm.tsx`
- `Training saved (basic mode). …` → same flash → Hide Gemini vs local → `TenantForm.tsx`
- `AI stays on the line and takes a message.` → `The assistant stays on the line and takes a message.` → No AI → `handoffMode.ts`
- `Add a business name and agent name` → `… assistant name` → Identity → `TestLinePanel.tsx`
- `Agent Persona` (link) → `Assistant` → Identity → `TestLinePanel.tsx`
- `Import knowledge` → `Add business information` → Owner word → `KnowledgeIngestPanel.tsx`
- `Add to my receptionist` → `Add to my assistant` → Product role → `KnowledgeIngestPanel.tsx`

### Calls

- `Train assistant` → `Teach assistant` → Align with Home → `calls/page.tsx`
- `Receptionist` (bubble) → `Assistant` → Speaker → `calls/[id]/page.tsx`
- `What the receptionist should say` → `What the assistant should say` → FAQ draft → `CallFaqSuggestions.tsx`

### Onboarding / marketing

- `Tone & handoff` → `Name & tone` → Drop handoff IA → `OnboardingWizard.tsx`
- `Receptionist name & tone` / `Receptionist name` → `Assistant name & tone` / `Assistant name` → Product role → `OnboardingWizard.tsx`
- `Could not build a receptionist prompt. Try again.` → `Could not finish assistant setup. Try again.` → No prompt → `onboarding/actions.ts`
- `The autonomous business assistant for Kenyan SMEs.` → `The business assistant for Kenyan SMEs.` → No autonomy → `LandingPage.tsx`
- Metadata titles with Autonomous → Business assistant for Kenyan SMEs → `layout.tsx`

### Keep (intentionally)

- `Save & train assistant` → keep → Established Save + assistant
- `Needs training` → keep → Allowed operational state
- `Train` section header → keep → IA
- `Test` tab and heading → keep → IA
- `Requests` / `Appointments` → keep → Routes
- Default value `Receptionist` for `agent_name` → keep → Spoken fallback

### Not owner UI (keep)

Prompt compiler, ingest extract system, FAQ Gemini system, Admin voices, pronunciation skip-list, `compileReceptionistPrompt` symbol.
