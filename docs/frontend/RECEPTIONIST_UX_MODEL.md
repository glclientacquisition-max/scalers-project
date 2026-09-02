# Scalers receptionist UX and business context model

**Status:** Phase 6D of Frontend 2.0. Research and recommendation only.  
**Owner-facing language (Phase 7):** [`BUSINESS_ASSISTANT_LANGUAGE_SYSTEM.md`](./BUSINESS_ASSISTANT_LANGUAGE_SYSTEM.md) supersedes receptionist as the product name. Architecture in this file still holds.  
**Date:** 2026-08-30  
**Lane:** Desk UI/UX (product architecture). Prompt policy, tools, and schema remain Brain / Platform.  
**Authority:** [`FRONTEND_CONSTITUTION.md`](./FRONTEND_CONSTITUTION.md), [`CUSTOMER_WORK_MODEL.md`](./CUSTOMER_WORK_MODEL.md), [`NAVIGATION_RESEARCH.md`](./NAVIGATION_RESEARCH.md), [`pages/receptionist.md`](./design-system/pages/receptionist.md), [`pages/settings.md`](./design-system/pages/settings.md)  
**Does not authorize:** UI, route, CSS, package, schema, backend, TenantForm split, Business settings redesign, Home redesign, Calls/Requests/Appointments redesign, or a seventh global Receptionist tab.

This document answers one question:

> What minimum business context does the receptionist need to correctly answer customers, identify customer work, schedule when appropriate, and hand off unresolved work, without forcing the owner to configure a CRM or workflow engine?

**Conceptual only.** Nothing here is an implementation proposal until product, Brain, and Platform approve it.

---

## 1. Executive summary

The owner should **configure a business and manage a receptionist**. The owner should never have to configure an AI workflow engine.

Phase 6C established the operational object:

```text
Conversation
    ↓
optional Customer Work
    ↓
optional Schedule
```

Phase 6D establishes the **business context** that makes that object honest:

```text
Business
    ├── Knowledge   (facts the receptionist may say)
    ├── Policy      (rules the receptionist must obey)
    └── Capability  (actions the receptionist may take)
            ↓
Receptionist (identity + compiled behavior + line)
            ↓
Conversation → optional work → optional schedule
            ↓
optional human handoff
```

**Business type is not a workflow engine.** Current `tenants.vertical` is already a prompt/playbook hint (`retail` and `home_services` inject job maps; `hospitality` and `general` do not). That is option **F**: a context hint plus capability *defaults*. It must not become an intent taxonomy (D) or a vertical product (E).

**Capabilities beat verticals.** A salon that also sells products, or a plumber who also books depot visits, cannot live inside one fixed workflow. Packs should seed terminology, suggested knowledge, and default tools. The owner overrides in human language. Overlap is the normal case.

**Work is optional.** `brainPolicy.js` already forbids collecting a name or creating a callback for a fully answered question. Persist work only when the receptionist made a promise the owner must keep, or could not finish. Never persist work merely because a conversation occurred.

**Handoff is two speeds.** Immediate escalate when the caller is angry, asks for a human, or the situation is urgent. Otherwise save work and notify later. `handoff_mode = live_transfer` is an owner preference. There is **no live-transfer executor** in the current voice runtime. The policy already forbids claiming a transfer that did not happen.

**Scheduling stays thin.** MVP needs a spoken *when* (`when_text`), and for visits a landmark. Time windows already exist on `appointments`. Staff, duration, and capacity are not MVP. Do not build a diary.

**Readiness is “can this receptionist handle calls?”** `assessMvpAnswerReadiness()` already scores that job (DID + compiled prompt + identity + hours + location + FAQ-or-fallback + owner notify). Home already maps it to **Line live / Number pending / Needs training**. Never show the numeric score. Never invent Online.

**No seventh tab.** Receptionist identity already lives in Business Train (Agent Persona, Tools & voice) plus Test plus the Home strip. Phase 7 may retitle and group those existing surfaces. It must not add a global destination.

---

## 2. Phase 6C dependency

Phase 6C ([`CUSTOMER_WORK_MODEL.md`](./CUSTOMER_WORK_MODEL.md)) is authoritative for work objects. This phase does not reopen that decision.

| 6C conclusion | 6D implication |
| --- | --- |
| Model D conceptually: Conversation → optional work → optional schedule | Receptionist capabilities must map onto those three layers, not invent a fourth object |
| MVP Model F: keep `service_requests` and `appointments` as unscheduled vs scheduled **views** | Capability `capture_request` writes the unscheduled view; `schedule` writes the scheduled view. Same concept, two tables |
| Work types: `enquiry \| hold \| order \| quote \| visit \| callback \| other` | Capabilities choose *whether* to write; playbooks choose *which type* |
| Never persist work because a conversation occurred | Knowledge answers create **no work** |
| No Work tab. No schema merge. No seventh Receptionist tab | This document does not propose either |
| Schedule = optional attribute cluster (`when_text`, window, place, resource) | Receptionist captures *when* in speech. It does not run a booking engine |
| Display aliases (Appointment / Booking / Reservation / Visit / Job) come from the pack | Terminology is a pack default, not a new entity |

6C asked 6D to keep receptionist language (Train / Test / Home strip) **separate** from any work-list visual merge. This document is that receptionist pass. It does not change Requests or Appointments.

Current routes remain:

```text
/home
/calls
/calls/[id]
/requests
/appointments
/settings
/wallet
```

Current storage remains:

```text
calls
service_requests
appointments
```

---

## 3. Current Scalers business context

Authoritative inventory from `docs/supabase/schema.sql`, related SQL comments, `src/db.js` tenant select, `dashboard/src/lib/tenant.ts`, and Settings `TenantForm` hidden fields. **No invented columns.**

### 3.1 Identity and line

| Concept | Source | Owner-facing today | Used on the call? |
| --- | --- | --- | --- |
| Business name | `tenants.business_name` | Signup + Settings | Yes. Live header `BUSINESS:` |
| Receptionist name | `tenants.agent_name` (default `Receptionist`) | Onboarding + Train Agent Persona | Yes. Greeting and header `YOUR NAME:` |
| Tone | `tenants.agent_tone` (`professional` \| `friendly` \| `empathetic` \| `localized`) | Onboarding + Train | Compiled into prompt. Onboarding offers all four; schema comment lists the same four |
| DID / line | `tenants.sautikit_virtual_number` (live E.164 or `pending:<id>`) | Home strip, Wallet/Buy number. Not a Train field | Call routing. Home: Line live vs Number pending |
| Active flag | `tenants.is_active` | Ops, not owner Train | Engine skip |

### 3.2 Knowledge (facts)

| Concept | Source | Owner-facing today | Used on the call? |
| --- | --- | --- | --- |
| Hours prose | `tenants.business_hours` | Onboarding “Hours & location” + Train Hours | Fallback `HOURS NOTES` if no structured schedule |
| Structured hours | `tenants.hours_schedule` jsonb weekly days | Train Hours | Live open/closed in context header |
| After-hours mode | `tenants.after_hours_mode` (`serve` \| `message`) | Train Hours | Header: keep serving vs message-only |
| Services prose | `tenants.services_offered` | Onboarding “Services & pricing” (free text) | Compiled knowledge; not a structured catalog |
| Services catalog | `tenants.services_catalog` jsonb `{name, price_range, notes, out_of_scope}` | Catalog tab (services) | Live ground truth SERVICES |
| Product catalog | `tenants.product_catalog` jsonb `{name, sku, category, price, unit, in_stock, notes, aliases[]}` | Catalog tab (products) | Live PRODUCT CATALOGUE. Retail playbook refuses holds on unknown titles |
| Locations | `tenants.business_locations` jsonb `{label, address, landmark, directions, coverage_notes}` | Onboarding landmark/directions + Train Locations | Live LOCATIONS. Directions must not invent streets |
| FAQs | `tenants.faqs` jsonb `{question, answer}` | Train FAQs | Live FAQ block |
| Unknown-answer line | `tenants.unknown_answer_fallback` | Train FAQs | Spoken when knowledge is missing |
| Policies | `tenants.business_policies` jsonb `{returns, delivery, payment, deposit, cancellation, warranty, other}` | Train Policies | Live POLICIES. Empty keys are unknown, not invented |
| Daily bulletin | `tenants.daily_bulletin` jsonb `{id, text, active, starts_at, ends_at}` | Updates tab | Live “Today’s update”; can override open/closed |
| Social / public channels | `tenants.social_handles` jsonb | Catalog (contact channels) | Compiled; not a primary spoken source |
| Compiled prompt | `tenants.llm_system_prompt` | Not edited raw. Produced by onboarding / Settings save / Import | Base prompt. Live header still wins |

### 3.3 Policy and notify (rules + who to tell)

| Concept | Source | Owner-facing today | Used on the call? |
| --- | --- | --- | --- |
| Owner WhatsApp | `tenants.whatsapp_notification_number` | Signup + Settings | Lead/work/escalation notify |
| Alert email | `tenants.alert_email` | Settings | Fallback notify |
| Notify channels | `tenants.notify_channels` jsonb default sms/whatsapp/email | Settings | Channel flags for alerts |
| Team directory | `tenants.team_directory` jsonb `{name, role, phone}` | Train Escalation Team | Escalation routing. Readiness wants a general/owner catch-all |
| Handoff preference | `tenants.handoff_mode` (`callback` \| `live_transfer`) | Onboarding Tone & handoff + Train | Prompt preference only. Live transfer is **not executed** |
| Escalation / end-call tools | `tenants.agent_tools` jsonb `{escalate, end_call}` defaults true | Train Tools & voice | `buildBrainCapabilities` reads these two. **Not** request/appointment toggles |

### 3.4 Pack, languages, voice, pronunciation

| Concept | Source | Owner-facing today | Used on the call? |
| --- | --- | --- | --- |
| Business pack | `tenants.vertical` (`general` \| `retail` \| `home_services` \| `hospitality`) | Onboarding Business type + Train (hidden in form) | Playbook router. Retail and home_services inject job maps. Hospitality and general inject **empty** |
| Voice languages | `tenants.voice_languages` default `{en, sw, sheng}` | **No owner picker.** `languageOptions.js` always auto | Prompt: match caller; mix if they mix. STT hints `en`, `sw` |
| Reserved other language | `tenants.voice_language_other` | Unused | Reserved. Locals (Kikuyu, Luo, …) explicitly not enabled |
| TTS voice | `tenants.soniox_voice_id`, `soniox_voice_label` | Train Tools & voice + Test preview | TTS identity |
| Pronunciation lexicon | `tenants.tts_lexicon` `{match, say, langs?, priority?}` | Train Pronunciation (human-approve) | TTS rewrite. Candidates are never auto-applied |
| Knowledge ingest | Import tab (`KnowledgeIngestPanel`) | Fetch/parse into catalog/FAQ drafts then compile | Indirect: fills knowledge fields, then compile |

### 3.5 Wallet and billing (not receptionist knowledge)

| Concept | Source | Receptionist knowledge? |
| --- | --- | --- |
| Wallet balance / low threshold | `wallet_balance_kes`, `wallet_low_balance_kes` | No. Owner Wallet + Home low-balance strip |
| Enforcement / soft spend / on-demand | `billing_enforcement`, `soft_spend_limit_*`, `on_demand_usage_enabled` | No. Ops/billing. Do not teach the receptionist to quote wallet state |

Wallet can **stop the line** (ops). It is not a fact the receptionist should discuss with callers.

### 3.6 Appointment / scheduling-related fields (already exist)

On **tenant**: hours, after-hours mode, locations (including `coverage_notes`), services catalog, handoff mode, vertical.

On **work rows** (not tenant config): `appointments.when_text`, `window_start`, `window_end`, `address_landmark`, `service_name`; `service_requests.when_text` (pickup/visit-ish, not a diary).

There is **no** staff roster, duration matrix, capacity calendar, or bookable-resource table.

### 3.7 What does not exist (do not invent)

- Owner capability matrix UI
- Intent taxonomy editor
- Workflow / automation builder
- Vertical-specific Settings destinations
- Receptionist Online / last-seen
- Language picker
- Live-transfer executor
- Health / Education / Professional Services as stored verticals (onboarding only has four: retail, home_services, hospitality, general)

---

## 4. Current receptionist architecture

Documented from repository behavior. Not inferred.

### 4.1 Live flow

```text
Tenant fields
    ↓
Onboarding / Settings save / Import
    ↓
promptCompiler (Gemini with local template fallback)
    ↓
tenants.llm_system_prompt
    ↓
Inbound voice call
    ↓
Live context header (clock, identity, open/closed, bulletin)
  + live ground truth (catalog, services, hours, locations, FAQs, policies, team)
  + vertical playbook (retail or home_services only)
  + AUTHORITY / ACTION POLICY (brainPolicy.js)
    ↓
STT (language hints en, sw)
    ↓
LLM (Gemini) + ###TOOL### markers
    ↓
toolExecution.js (authorize vs capabilities, then persist)
    ↓
Spoken confirmation from backend (not from the same model turn)
    ↓
optional service_request / appointment / escalate notify
```

Highest-priority live text is `buildContextHeader` in `src/prompts.js`. Compiled `llm_system_prompt` is the base. Playbooks are injected for two verticals only.

### 4.2 Where the system decides each job

| Decision | Actual mechanism today |
| --- | --- |
| What the business is | `business_name` + `vertical` + compiled prompt identity. Header: `You are {agentName} for {businessName}` |
| What it offers | `services_offered` prose + `services_catalog` + `product_catalog`. Playbook: answer only from those lists. Unknown → unknown-answer line |
| What it can answer | Live ground truth + FAQs + hours + locations + policies + bulletin. `answerFromKnowledge` is **always true**. Policy: never invent prices, stock, hours, availability, people, bookings |
| What it can book | Runtime passes `createAppointment: true` on live calls (`server.js`). Home-services playbook requires service + name + when + landmark before `create_appointment`. Retail playbook does **not** book visits; it holds/orders. Hospitality has **no** dedicated booking pack |
| What it should hand off | `agent_tools.escalate` (default on). Playbooks: explicit “human”, emergency (home services), justified escalate. `handoff_mode` chooses callback wording vs transfer *preference*. `liveTransfer` is false unless runtime sets it; production sets `liveTransfer: false` |
| What it should save | `saveCallerInfo` always on. `create_service_request` / `create_appointment` when the playbook’s slots are filled **and** the tool is authorized. Retail: hold needs product + name + when, and the title must be in the product catalog |
| What it should not save | Authority policy: “Do not collect a name or create a callback for a fully answered question.” Hours, directions, catalog price (when known), in-stock (when known) complete with `tool: null` |

### 4.3 Capabilities vs owner toggles (fact)

`buildBrainCapabilities` (`src/conversation/brainPolicy.js`):

| Capability flag | Source | Owner can turn off? |
| --- | --- | --- |
| `answerFromKnowledge` | always true | No |
| `saveCallerInfo` | always true | No |
| `createServiceRequest` | runtime, default true | **No owner toggle.** Always true on live `server.js` calls |
| `createAppointment` | runtime, default true | **No owner toggle.** Always true on live calls |
| `updateAppointment` | runtime, default true | No owner toggle |
| `notifyCallback` | runtime, default true | No owner toggle |
| `escalate` | `agent_tools.escalate` | Yes (Train Tools) |
| `endCall` | `agent_tools.end_call` | Yes (Train Tools) |
| `liveTransfer` | runtime must be true | Not available. Production false |

So today the receptionist **can technically write both request and appointment rows for every tenant**. Vertical playbooks try to steer *which* tool to use. Hospitality and general get no playbook, only core conversation rules.

That is already a capability architecture with a vertical *hint*, not a locked workflow. It is also a failure mode: a retail tenant can still book an “appointment” if the model ignores the playbook.

### 4.4 Voice-first behavior already in the prompt

`CONVERSATION_RULES` in `src/prompts.js`:

- Match English / Kiswahili / light Sheng; switch if the caller switches
- One clarifying question per turn
- Spoken replies under 25 words
- Times as spoken (“3 P M” / “saa 3 jioni”), money as words
- Do not require software nouns from the caller
- Tool success is spoken **after** backend confirmation, never in the same turn as the marker

The caller is not asked to say “create an appointment.” Home-services patterns include `njoo`, `nitakuja`, `fix`, `book`. Retail patterns include `bei`, `mna`, `weka`, `nitapita`.

---

## 5. Business type analysis

Current stored type: `tenants.vertical` with four values. Owner copy in `dashboard/src/lib/vertical.ts`:

| id | Label | Blurb |
| --- | --- | --- |
| `retail` | Retail / shop | Products and stock |
| `home_services` | Home services | Repairs and visits |
| `hospitality` | Hotel / lodge / restaurant | Stays and tables |
| `general` | Other / general | General receptionist |

### Options

| Option | Meaning | Fit |
| --- | --- | --- |
| **A. Display label only** | Cosmetic. No prompt or tool effect | Too weak. Playbooks already change jobs for retail and home services |
| **B. Prompt/context hint** | Changes wording and job map in the prompt | True today for two packs. Incomplete alone: tools stay globally on |
| **C. Capability selector** | Type turns tools on/off | Useful as *defaults*, dangerous as a hard lock (a shop that books fittings would lose schedule) |
| **D. Intent taxonomy selector** | Type loads a different intent enum the owner must maintain | Reject. Owners do not edit intents. Playbook regexes are Brain internals |
| **E. Workflow selector** | Type loads a CRM pipeline (Request → Quote → Job, or Booking FSM) | Reject. 6C already refused vertical products and Jobber-shaped FSMs |
| **F. B + C** | Type hints the prompt **and** suggests default capabilities; owner can override | **Recommended** |

### Recommendation: F

**Evidence (not a requirement):** Jobber lets an account customize request forms, arrival windows, and products/services in settings. It does not ship a separate product per trade ([Jobber request forms](https://help.getjobber.com/hc/en-us/articles/39026037947543-Requests-and-Bookings-Settings), [Jobber work settings](https://help.getjobber.com/hc/en-us/articles/115009737088-Work-Settings)). Square Bookings is a booking *object* with services and staff, not a “salon app vs clinic app” fork ([Square Booking](https://developer.squareup.com/reference/square/objects/Booking)).

**Scalers recommendation:** keep `vertical` as a **pack id**. On onboarding it should:

1. Seed prompt playbook (already: retail, home_services).
2. Seed default capabilities conceptually (retail → catalog + capture request; home_services → schedule + capture request; hospitality → schedule as reservation alias; general → answer + capture + handoff).
3. Seed display labels (Visit vs Booking vs Reservation).
4. Never hide Settings fields. Never fork routes.

Hospitality today is **A+weak B**: a label with an empty playbook. That is a gap, not a reason to build a hotel PMS.

Do not add Health, Education, or Professional Services as new stored enums in MVP. Map them to `general` or `home_services` at onboarding until a pack actually changes tools. Extra radio buttons without playbooks are costume.

---

## 6. Capability vs vertical analysis

### Two candidate architectures

```text
A. Business type → fixed vertical workflow
   Salon always books. Retail never books. Clinic is a different app.

B. Business → Capabilities → Receptionist behavior
   A business may answer, capture work, and/or schedule.
   Packs suggest which of those start on.
```

### Why B

Overlap is real in the Kenyan SME mix 6C already listed:

| Business | Catalog | Requests | Schedule | Notes |
| --- | --- | --- | --- | --- |
| Electronics shop | Yes | Hold / order | Rare | Retail beachhead |
| Salon | Services list | Walk-in waitlist | Yes | Appointment-heavy, still sells products |
| Plumber | Services + areas | Quote / job | Window + landmark | Home-services beachhead |
| Hotel | Room types (future) | Enquiry | Reservation | Hospitality label, no pack yet |
| Lawyer | Services prose | Callback / consult | Maybe | Lead-heavy; human almost always |
| Tutor | Subjects | Enrolment enquiry | Lesson slot | Mixed |
| Clinic | Services | Callback | Appointment | Same schedule cluster as salon; **no medical policy in product** |

A type→workflow engine would mis-serve the salon that also sells oil, and the retailer who books phone-repair drop-offs.

**Evidence:** Salesforce Field Service separates **Work Order** (what) from **Service Appointment** (when) ([WorkOrder](https://developer.salesforce.com/docs/atlas.en-us.field_service_dev.meta/field_service_dev/sforce_api_objects_workorder.htm), [ServiceAppointment](https://developer.salesforce.com/docs/atlas.en-us.object_reference.meta/object_reference/sforce_api_objects_serviceappointment.htm)). Dynamics does the same with work orders vs bookings ([architecture](https://learn.microsoft.com/en-us/dynamics365/field-service/field-service-architecture)). Scalers already mirrored that in 6C. Capabilities are the *receptionist-side* of the same split: what the agent is allowed to *do*, not which industry app it is.

**Scalers recommendation:** architecture B. Vertical packs are **defaults**, not product modes.

Packs may control, as defaults the owner can override:

| Pack control | Default? | Hard lock? |
| --- | --- | --- |
| Terminology (Visit / Booking / Hold) | Yes | No |
| Suggested onboarding copy | Yes | No |
| Suggested knowledge (catalog vs services) | Yes | No |
| Default capabilities | Yes | No (except physically unavailable tools, e.g. live transfer) |
| Work types offered in playbooks | Yes | Soft: Brain may still write the other table today |
| Scheduling required slots | Yes | Soft: home services already requires four slots |
| Fields captured from callers | Yes, via playbook slots | No extra owner schema |
| Onboarding guidance | Yes | No |

Do **not** let packs control: global nav, extra routes, extra tables, owner-facing intent lists, medical/legal special modes.

---

## 7. Knowledge vs policy vs capability

These must stay **three concepts**. Mixing them is how owners get a “prompt box” and agents hallucinate permissions.

| Layer | Definition | Scalers sources today | Owner language |
| --- | --- | --- | --- |
| **Knowledge** | Facts the receptionist may say if present | Hours, locations, FAQs, catalogs, bulletin, services prose, social handles | “What we offer and how to find us” |
| **Policy** | Rules about what the receptionist may claim or refuse | `business_policies`, after-hours mode, unknown-answer line, authority policy, empty = unknown | “What we allow” (deposits, returns, no invented prices) |
| **Capability** | Actions the runtime will actually perform | Tools + playbook completion + `buildBrainCapabilities` | “What the receptionist can do on a call” |

### Examples

| Caller | Knowledge | Policy | Capability |
| --- | --- | --- | --- |
| “Mnafunga saa ngapi?” | Hours / schedule / bulletin | Do not invent hours | `answer_information` only |
| “Bei ya S25?” | Product catalog price | Never invent KSh | Answer, or admit unknown. Work only if they then want a quote |
| “Weka moja” | Title must exist in catalog | Hold needs name + when | `capture_request` type hold |
| “Njoo kesho saa nne, burst pipe” | Services + coverage | Emergency: no fake ETA; escalate when justified | `schedule` and/or `handoff` |
| “Nipe owner” | Team directory | Handoff mode; never claim transfer | `handoff` |

**Evidence:** Intercom separates **knowledge content** (articles/snippets that Fin may answer from) from **tickets** (async work that outlives the conversation) and from **handoff to a teammate** vs **handoff to a ticket** ([Tickets explained](https://www.intercom.com/help/en/articles/6436600-tickets-explained), [Fin procedures](https://www.intercom.com/help/en/articles/13449439-building-fin-procedures), [content types](https://www.intercom.com/help/en/articles/9357928-overview-of-content-types-and-when-to-use-them)). Answer from knowledge. Persist work only when the conversation cannot finish the job. Route to a human when a human must speak now.

**Scalers recommendation:** keep the three layers separate in the product model. Settings already roughly maps them (Catalog/Hours/FAQs = knowledge, Policies/after-hours/unknown line = policy, Tools & handoff = capability). Do not collapse them into one “AI instructions” textarea. Do not expose the words Knowledge / Policy / Capability as an owner taxonomy unless copy tests demand it. Prefer:

- Catalog, Hours, Locations, FAQs, Updates
- Policies
- What the receptionist can do (existing Tools + handoff, later clearer labels)

---

## 8. Receptionist capability model

Candidate list from the brief, classified against **actual tools** and 6C work types. Do not assume all should exist as owner toggles.

| Candidate | Class | Maps to today | MVP owner control |
| --- | --- | --- | --- |
| `answer_information` | **Universal** | `answerFromKnowledge` always | None. Always on if knowledge exists |
| `answer_catalog` | **Optional** | Same answer path; gated by catalog rows | Inferred: if product/services catalog has names. Retail readiness *hints* catalogue; does not require it |
| `capture_lead` | **Universal** | `save_caller_info` always | None. Always on. This is conversation memory, not Customer Work |
| `capture_request` | **Optional** | `create_service_request` | Inferred from pack default + tool existence. **No owner toggle today.** Do not add a matrix in MVP |
| `capture_callback` | **Optional** | request type `callback` + after-hours message mode | Same tool as capture_request. After-hours `message` already steers toward callback |
| `schedule` | **Optional** | `create_appointment` | Inferred from pack (home_services / hospitality). Runtime currently always allows the tool |
| `reschedule` | **Optional** | `update_appointment` | Same as schedule. Home-services playbook only |
| `cancel` | **Optional** | `update_appointment` status cancelled | Same as schedule |
| `take_order` | **Future / dangerous as OMS** | request type `order` | Keep as a **work type**, not a commerce engine. No stock decrement, no checkout |
| `capture_quote_request` | **Optional** (type may stay `enquiry`) | Retail unknown price → enquiry; home_services price_band + enquiry | No new tool. 6C: map quote → enquiry until a type exists |
| `handoff` | **Universal** (toggle already exists) | `escalate` | Existing Tools checkbox |
| `send_followup` | **Future** | Notify after saved request (`notifyCallback`) | Not an owner capability. It is a side effect of saved work |

### Smallest useful set (conceptual)

```text
Universal:     answer_information, capture_lead, handoff
Optional:      answer_catalog, capture_request (incl. callback / order / quote-as-enquiry), schedule (incl. reschedule / cancel)
Do not ship:   take_order as OMS, send_followup as a workflow, live transfer as a claimed action
```

**Owner-facing translation (never show the ids):**

- Answer questions from what I taught
- Save a note when the customer needs me
- Book a time when that is how we work
- Call me in when it is urgent or they ask for a person

Capabilities are **inferred** from existing business context (catalog filled, hours filled, vertical, tools, after-hours) plus pack defaults. MVP must not add a capability checklist screen.

---

## 9. Work creation policy

**Principle:** Never create persistent Customer Work merely because a conversation occurred.

This is already written into authority policy and 6C. Restate as product law.

### No work

| Intent | Example | Capability | Persist? |
| --- | --- | --- | --- |
| Hours / open now | “Mnafunga saa ngapi?” | Answer | No |
| Location | “Mko wapi?” | Answer | No |
| Simple FAQ | “Mnaccept M-Pesa?” if policy has payment | Answer | No |
| Catalog price (known) | “Bei ya Samsung S25?” | Answer catalog | No |
| In stock (known) | “Iko S25?” | Answer catalog | No |
| Fully resolved information | Any of the above, caller says thanks | Answer | No. Do not collect a name |

`calls` still persist. `lead_status` may stay `new` until the owner triages the **conversation**. That is not Customer Work.

### Work (unscheduled)

Create `service_request` (conceptual unscheduled work) when **owner action or a promise** remains:

| Intent | Example | Type (6C) |
| --- | --- | --- |
| Hold | “Weka moja, nitapita jioni” | hold |
| Order to process | “Nataka 50 pieces for the company” | order |
| Quote / unknown price | “How much for a custom sign?” | enquiry (quote mapped) |
| Callback requested | “Nipigie baadaye” | callback |
| Service without a committed time | “Fix my sink sometime this week” | enquiry / other |
| Unresolved issue | Complaint that is not an immediate escalate | enquiry / other |
| After-hours message mode + caller wants contact | Closed + “leave a message” | callback |

Required honesty: speak “Let me save that.” Backend confirms. Never say “held” or “booked” in the tool turn.

### Scheduled work

Create `appointment` (conceptual scheduled work) only when **time was committed in the conversation**:

| Intent | Example |
| --- | --- |
| Visit requested | “Njoo kesho saa nne, burst pipe at South B” |
| Booking requested | “Book braids Friday 2” |
| Reservation requested | “Table for 4 at 7” (hospitality; pack not built; still a schedule cluster) |
| Lesson / consult slot | “Tuesday 4 with the tutor” |

If they want a visit but cannot give a window, that is **unscheduled work**, not a fake appointment.

### “Can the receptionist do this?”

For every inbound intent, evaluate in this order:

```text
1. Can answer immediately from knowledge/policy?  → speak. no work
2. Can complete automatically with an existing tool? → tool, then confirm
3. Needs a promise the owner must keep? → create work (request or scheduled)
4. Needs a human on this call? → handoff (escalate), and usually also work or save_caller_info
5. Otherwise → unknown line + optional enquiry if the caller wants follow-up
```

Worked examples:

| Caller | Immediate? | Auto-complete? | Work? | Schedule? | Human? |
| --- | --- | --- | --- | --- | --- |
| “What time do you close?” | Yes | Yes (answer) | No | No | No |
| “How much is Samsung S25?” (price on file) | Yes | Yes | No | No | No |
| “How much is Samsung S25?” (price blank) | Admit unknown | No | Maybe enquiry if they want a quote | No | Maybe |
| “I need 50 Samsung phones for my company.” | Partial | No | Yes (order/enquiry) | No | Maybe |
| “Can you send someone to fix my sink?” | Partial | If slots filled | Yes | Maybe (if they give a window + landmark) | Maybe |
| “Book me for Friday at 2.” | If service known | `create_appointment` attempt | Yes | Yes | Maybe (owner confirms; agent must not invent confirmed-in-diary) |
| “Nataka kuja kesho saa nne.” | Infer schedule intent | Same | Yes | Yes | Maybe |
| “Nipe manager.” | No | Escalate if enabled | Usually save name/reason | No | **Yes, now** |

---

## 10. Human handoff model

Two speeds. Do not invent medical or legal advice. Product behavior only.

```text
Immediate:  receptionist → owner (escalate / notify now, stay on the line taking a message)
Later:      receptionist → persistent work → owner when free
```

### Immediate (this call)

| Situation | Product behavior today / recommended |
| --- | --- |
| Caller asks for a person | Home-services and retail `human` intents: capture name + reason, escalate if enabled. Never claim live transfer |
| Angry / frustrated | Header MOOD: empathetic, no cheerful filler. Escalate when justified, not because they sighed once |
| Emergency / urgent (home services patterns: burst, flood, hatari, sasa hivi) | Acknowledge. Capture. Escalate. **Do not invent ETA** |
| Explicit “this cannot wait” | Same as human/emergency |

`handoff_mode = callback` (default): notify WhatsApp/email. AI stays on the line.

`handoff_mode = live_transfer`: owner *wants* a connect. Runtime **cannot**. Policy: “NOT AVAILABLE — never claim you are transferring the call.” UI already says transfer falls back to callback.

### Later (work for the owner)

| Situation | Persist | Immediate escalate? |
| --- | --- | --- |
| Uncertain pricing / custom quote | enquiry | No, unless they demand a human |
| Negotiation / discount | enquiry; do not invent a deal | Only if they refuse to leave a note |
| Exception request (after hours job, out of area) | enquiry + honest policy | If they insist on speaking to owner |
| Order needs processing | order | No |
| Complaint that can wait | enquiry | If anger is high, yes |
| Medical-sensitive / legal-sensitive | **No special clinical mode.** Unknown line + human if they ask. Do not diagnose, do not give legal advice. Capture callback | Prefer human if they ask for a clinician/lawyer by role |

**Evidence:** Intercom Fin’s “Handoff to Ticket” is for structured follow-up that should **not** require a teammate on the same conversation; teammate routing is a different action ([Fin procedures](https://www.intercom.com/help/en/articles/13449439-building-fin-procedures)). Scalers should keep the same split: escalate = human attention now; Customer Work = human attention later.

Do not add a “priority” FSM. Open work and `needs_human` on the call are enough for MVP.

---

## 11. Scheduling model

6C: **Schedule = optional attribute cluster on work.** This phase only decides what the receptionist must capture in speech.

| Slot | In data today | MVP for voice capture | Why |
| --- | --- | --- | --- |
| When (spoken) | `when_text` on both tables | **Required** for scheduled work | Callers say “kesho saa nne”, not ISO timestamps |
| Time window | `appointments.window_start` / `window_end` | Optional | Nice if parsed; not required to *request* a visit |
| Location | `address_landmark` | **Required for going-to-customer visits** (home-services playbook already). Optional for in-shop bookings | Landmark is how Kenyan callers locate |
| Person / resource | **None** | **Not MVP** | No staff table. Do not pretend “Book with Jane” is confirmed |
| Capacity | **None** | **Not MVP** | Hotel/restaurant covers later |
| Duration | **None** | **Not MVP** | Salon duration matrices are a booking engine |

**Evidence:** Square’s Booking object includes start time, location, and team member because Square is a diary ([Booking](https://developer.squareup.com/reference/square/objects/Booking)). Jobber uses **arrival windows** as a default the owner can set, not a global optimizer ([Work settings](https://help.getjobber.com/hc/en-us/articles/115009737088-Work-Settings)). Dynamics Universal Resource Scheduling is explicitly **not** what a receptionist MVP is ([URS](https://learn.microsoft.com/en-us/dynamics365/field-service/universal-resource-scheduling-for-field-service)).

**Scalers recommendation:** capture a requested time in language the owner can read. Status stays `requested` until a human confirms. The receptionist must not say “you are booked in the calendar” unless a later product actually checks availability (it does not).

After-hours: if mode is `message`, do not schedule same-day fulfillment. Offer a callback. If mode is `serve`, still answer knowledge; only schedule if policy and hours allow the *request*, and stay honest that staff may not be on site.

---

## 12. Business terminology

Internal noun stays **scheduled work** (6C). Owner/caller nouns are **display aliases**.

| Pack default | Display for scheduled work | Display for unscheduled work |
| --- | --- | --- |
| `home_services` | Visit (Job is acceptable in empty states later) | Request / quote |
| `retail` | (rare) Pickup / fitting | Hold / order / enquiry |
| `hospitality` | Reservation | Enquiry |
| `general` | Appointment | Request |
| Salon mapped to general or home_services | Booking | Request |
| Clinic mapped to general | Appointment | Callback |
| Tutor mapped to general | Lesson / booking | Enquiry |

**Where labels should come from:** pack defaults, later overridable in business configuration if owners complain. **Not** inferred by the LLM at render time (unstable). **Not** a new entity per alias.

Do not create separate universal objects named Appointment, Booking, Reservation, Visit, Job, Consultation.

MVP desk copy may keep “Appointments” as the route title (6C: keep URLs). Row-level type words can still say Visit or Hold. Changing the nav word is a later copy PR, not this phase.

Voice: the receptionist already speaks everyday words (`visit`, `hold`, `callback`). Callers never need the table names.

---

## 13. Kenyan multilingual considerations

### What already exists (do not build a new engine)

`src/conversation/languageOptions.js`:

- Automatic languages: English, Kiswahili, Sheng
- Ignore any stored picker values
- Mirror mix lightly
- Kikuyu, Luo, and other locals: **not enabled**; reply in Kiswahili or English if heard
- STT hints: `en`, `sw` (Sheng is not a separate STT code)

Prompt rules already cover: money as words, times as `saa` / “3 P M”, short sentences, sparse Sheng, name confirmation/spelling.

Playbook regexes already include mixed cues: `bei`, `mnafungua`, `uko wapi`, `weka`, `nitapita`, `njoo`, `hatari`, `ahirisha`.

### What context the receptionist needs (not a new subsystem)

| Phenomenon | Need | Already? |
| --- | --- | --- |
| Intent in mixed language | Patterns + LLM, not an owner taxonomy | Yes, imperfect |
| Business terminology | Knowledge in the language the owner typed; agent mirrors caller | Owner types mostly English in Settings. Agent translates on the fly. **Gap:** FAQs authored only in English may be weaker in Kiswahili. Mitigation: unknown line, not a bilingual CMS |
| Local phrasing | Prompt “sound like a Kenyan receptionist” | Yes |
| Names | Confirm/spell; TTS lexicon | Yes (human-approve lexicon) |
| Locations | Landmark + directions fields | Yes |
| Time expressions | `when_text` as spoken; EAT clock in header | Yes |
| Phone numbers | Caller ID + spoken confirm | Voice/Platform. Not a 6D UI |
| Quantities | `quantity` on requests | Yes |
| Dates | Spoken `when_text`; no calendar widget on the call | Yes |

**Do not** add a language picker, Sheng intensity slider, or per-intent translation table. Owner configuration stays human language in whatever language they write. The line already matches the caller.

---

## 14. Onboarding implications

Current wizard (`OnboardingWizard.tsx`):

```text
1. Business type     → vertical
2. Services & pricing → services_offered (prose, min 12 chars)
3. Hours & location  → business_hours + optional landmark/directions → business_locations
4. Tone & handoff    → agent_tone, agent_name, handoff_mode, compile prompt
```

Signup already captured `business_name` and `whatsapp_notification_number`.

### Classification (document only; do not redesign)

| Item | Class | Notes |
| --- | --- | --- |
| Business type | Essential | Pack defaults. Four options are enough |
| Services/pricing prose | Essential but incomplete | Seeds `services_offered`. Does **not** fill `services_catalog` or `product_catalog` |
| Hours + location prose | Essential | Readiness requires hours + a location row. Structured `hours_schedule` is optional polish |
| Tone | Essential for identity | Affects prompt, not tools |
| Handoff mode | Useful | Preference; live transfer still unavailable |
| Landmark / directions | Useful | Strong for home services |
| Structured catalog | **Missing but essential after go-live** for retail price/hold | Train Catalog. Not a fifth onboarding step in this phase |
| FAQs or unknown-answer line | **Missing but essential** for readiness | Train FAQs. Onboarding does not collect them, so many tenants hit Needs training |
| Policies | Useful but optional | Empty = unknown (correct) |
| Bulletin | Useful | Updates after go-live |
| Voice / pronunciation | Future / optional | Train later |
| Language picker | Unnecessary | Auto en/sw/sheng |
| Capability matrix | Unnecessary | Infer from type + later Train |
| Intent/workflow editor | Unnecessary | Never |

Onboarding already captures **enough to compile a prompt and open a line**. It does **not** capture enough for retail holds or FAQ-quality answers. That is a Train job, which readiness already points at. Do not add steps here.

---

## 15. Business settings implications

Extracted IA (keep):

```text
Updates · Catalog · Train (header) · Import · Test
```

Train panels today: Agent Persona, Hours, Locations, Policies, Escalation Team, FAQs, Tools & voice, Pronunciation.

### Where receptionist concepts belong (no new global destination)

| Concept | Natural home | Not |
| --- | --- | --- |
| Identity (name, tone, voice) | Train → Agent Persona + Tools & voice | New Receptionist tab |
| Knowledge | Catalog + Hours + Locations + FAQs + Updates | Prompt editor |
| Policy | Train → Policies + Hours (after-hours) + unknown-answer | Workflow builder |
| Capabilities | **Inferred** from Catalog/vertical/tools. Existing Tools & voice for escalate/end call | Capability matrix page |
| Handoff | Agent Persona / Tools (already `handoff_mode`) | Live-transfer marketing |
| Test / readiness | Test tab + Home strip | Online badge |
| Import | Import tab | Silent auto-lexicon |

Phase 6A/6B: **no seventh global Receptionist tab.** [`pages/receptionist.md`](./design-system/pages/receptionist.md): existing fields only; Test + identity + Home strip.

Phase 7 (proposal only) may retitle “Agent Persona” toward receptionist identity **without** changing compile, as [`pages/settings.md`](./design-system/pages/settings.md) already allows.

Do not put capabilities on Home. Home shows whether the line can work, not a tool schema.

---

## 16. Receptionist entity model

Phase 6A: treat the receptionist as an entity **from existing fields**. No new table.

```text
Receptionist
    name            agent_name
    voice           soniox_voice_id / label
    languages       product default en/sw/sheng (not a picker)
    tone            agent_tone
    business knowledge   catalogs, hours, locations, FAQs, bulletin, services_offered
    capabilities    inferred + agent_tools.escalate/end_call
    line            sautikit_virtual_number
    status          Line live | Number pending | Needs training
```

### Four layers (do not collapse)

| Layer | Meaning | Sources | Show to owner? |
| --- | --- | --- | --- |
| **Identity** | Who is speaking | name, voice, tone, languages | Yes. Persona + Test |
| **Configuration** | What they know and may do | knowledge + policy + tools + vertical | Yes. Train/Catalog, in business English |
| **Readiness** | Can they handle typical calls? | `assessMvpAnswerReadiness` required items | Yes as gaps, never as a score |
| **Operational state** | Is the phone reachable? | DID live vs pending | Line live / Number pending only |

**Forbidden:** Online, last-seen, “AI active”, pulse dots.

Wallet empty may take the line down (ops). That is billing state, not receptionist presence. Do not merge them into a fake presence model.

---

## 17. Readiness model

`assessMvpAnswerReadiness()` (`dashboard/src/lib/mvpAnswerReadiness.ts`) comment:

> Score whether a tenant can efficiently answer unanswered calls (MVP job).

### Required today

1. Live DID (not `pending:`)
2. Compiled prompt (≥ 80 chars)
3. Agent name and tone
4. Hours (prose or structured)
5. Location / landmark
6. FAQs **or** unknown-answer line
7. Owner notify (WhatsApp or email)

### Optional today

- Structured weekly schedule
- Escalation catch-all teammate
- Product catalogue (hinted harder for `vertical === retail`, still not required)

Home (`commandCenter.ts`): DID → Line live / Number pending; first required gap (skipping DID if pending already shown) → Needs training. **Score is computed and must not appear in UI** (constitution).

### Conceptual relationship

```text
Business completeness     hours, location, catalog, FAQs, policies
        +
Receptionist identity     name, tone, compiled prompt
        +
Capabilities              tools + pack defaults (not scored as a matrix)
        +
DID status                reachable line
        =
Readiness                 can this receptionist handle inbound calls?
```

Wallet is a **separate gate**. A ready receptionist with an empty prepaid wallet is a billing problem, not “Needs training.”

**Recommendation (conceptual):** keep answering “Can my receptionist successfully handle calls?” Required items already match that. Do not retarget the helper at “Is my account configured?” (membership, wallet top-up, pronunciation studio). Catalogue remaining optional is correct: a clinic can answer hours without SKUs.

Do not change the implementation in this phase.

---

## 18. Receptionist → Customer Work relationship

Capabilities write 6C objects. They do not create new genera.

```text
answer_information / answer_catalog
        ↓
Conversation only. No Customer Work.

capture_lead
        ↓
save_caller_info / contacts. Still not Customer Work unless a request/appointment is also created.

capture_request / capture_callback / take_order (as note) / capture_quote_request
        ↓
Customer Work type = enquiry | hold | order | callback | other
schedule cluster = none (unless when_text is a pickup promise, still not a diary)

schedule / reschedule / cancel
        ↓
Customer Work type = visit (scheduled view)
schedule = when_text + optional window + landmark

handoff
        ↓
escalate notify now. Usually also save_caller_info.
Work row only if a promise remains after the call (callback, visit, order).
Anger + resolved FAQ = no work if nothing is left to do.
```

Examples:

| Capability used | Work type | Schedule |
| --- | --- | --- |
| Answer hours | none | none |
| Hold phone | hold | optional pickup `when_text` |
| Bulk order note | order | none |
| Unknown price follow-up | enquiry | none |
| Book visit | visit | requested when + landmark |
| Cancel visit | visit (status cancelled) | existing |
| Escalate to owner | none or callback | none |

Brain owns the tools. Desk must not invent a parallel “create work” control on Settings.

---

## 19. Vertical test matrix

Pack ids below are **defaults**. Overlap is allowed.

| Business | Typical call | Intent | Capability | Work? | Schedule? | Human? |
| --- | --- | --- | --- | --- | --- | --- |
| Salon | Book braids Friday 2 | Booking | Schedule | Yes | Yes | Maybe (confirm) |
| Salon | “Mna oil ya braid?” | Catalog | Answer catalog | No if answered | No | No |
| Clinic | See doctor Tuesday | Appointment | Schedule | Yes | Yes | Maybe |
| Clinic | “Mnafungua saa ngapi?” | Hours | Answer | No | No | No |
| Retail | “Bei ya S25?” | Information | Knowledge | No | No | No |
| Retail | Bulk 50 phones | Order | Capture work | Yes | No | Maybe |
| Retail | “Weka moja nitapita” | Hold | Capture work | Yes | Pickup text only | No |
| Plumber | Fix sink South B kesho | Service request | Capture + maybe schedule | Yes | If window given | Maybe |
| Plumber | Burst pipe sasa hivi | Emergency | Handoff | Maybe callback | No fake ETA | **Yes** |
| Hotel | Reserve room | Reservation | Schedule | Yes | Yes | Maybe |
| Hotel | “Mnatoa breakfast?” | FAQ | Answer | No | No | No |
| Restaurant | Table for 4 at 7 | Reservation | Schedule | Yes | Yes | Maybe |
| Lawyer | Want a consultation | Lead/request | Capture work | Yes | Maybe | **Yes** often |
| Accountant | Tax filing quote | Quote | Capture work | Yes | No | Maybe |
| Tutor | Lesson Thursday 4 | Booking | Schedule | Yes | Yes | Maybe |
| Tutor | “Fees ni ngapi?” | Information | Answer | No if known | No | No |
| Electronics repair | Drop phone Saturday | Hybrid | Capture + schedule | Yes | Yes (in-shop) | No |
| Pharmacy | “Iko Panadol?” | Catalog | Answer | No | No | No. No clinical advice |
| School | Admission enquiry | Lead | Capture work | Yes | Maybe visit | Maybe |
| Garage | Quote for clutch | Quote | Capture work | Yes | Maybe | Maybe |
| Cleaning | Weekly house clean | Recurring (deferred) | Capture work | Yes as enquiry/visit | Window | No recurring engine |
| General SME | Mixed | Infer | Answer or capture or schedule | Only if unfinished | Only if time committed | If asked |

Voice-first row (required by the brief):

| Caller | Must not require | System should infer |
| --- | --- | --- |
| “Nataka kuja kesho saa nne.” | “I would like to create an appointment.” | Schedule intent + when_text + ask service/name if missing |

---

## 20. Failure modes

| Risk | What it looks like | Product mitigation |
| --- | --- | --- |
| Over-classification | Every call becomes a request | Authority policy + 6C law. Desk must not badge “0 requests” as failure. Brain: no row if answered |
| Under-classification | Holds/visits only in the transcript | Playbook required slots; Test line; readiness so knowledge exists to classify against |
| False work creation | Hours question creates a callback | Already forbidden in `formatAuthorityPolicy`. Treat regressions as Brain bugs, not a new UI toggle |
| Wrong scheduling | “Booked” when only requested | Copy: status requested. Agent must not claim diary confirmation. Backend speaks success of *save*, not of *calendar commit* |
| Wrong business assumptions | Hospitality tenant gets retail hold language | Pack playbook for hospitality is empty today. Until a pack exists, keep general rules; do not fake hotel inventory |
| Vertical overfitting | Nav/settings fork per type | Forbidden. One desk. Packs default, owner overrides |
| Owner configuration burden | Intent editors, capability matrices, workflow canvases | Configure business in human fields. Infer capabilities. No seventh tab |
| Multilingual ambiguity | Sheng mix mis-filed as “other” | Existing mirror rules + `when_text` as raw speech. Confirm names. Do not add a classifier UI |
| Hallucinated capabilities | “I’m transferring you” / invented price / invented slot | `liveTransfer` false; never invent prices; appointments are requests; empty policy = unknown |
| Dual-write | Retail model also inserts an appointment | Runtime currently allows both tools for all tenants. **Brain/Platform issue.** Product: playbooks should remain the steering layer until owner-level capability defaults exist. Do not paper over with a Desk toggle in 6D |
| Readiness as vanity score | Showing 73% | Constitution: never show `score` |
| Fake Online | Pulse on Test/Home | Forbidden labels only |

---

## 21. Design implications

Do not design screens. Principles for later Desk work:

1. **Show the receptionist as a person assembled from existing fields**, not as a model card.
2. **Show readiness and line state**, not tokens, tools schemas, or compile internals.
3. **Configure capabilities through business context** (catalog, hours, type, policies, tools already in Train).
4. **Do not expose intent taxonomies**, regex playbooks, or `primary_intent` enums in owner chrome.
5. **Do not expose a workflow engine** or automation builder.
6. **Do not create vertical-specific navigation** or a Receptionist global tab.
7. **Use business terminology** (Hold, Visit, Reservation) in rows and empty states; keep route titles stable until a dedicated copy PR.
8. **Keep operational work separate from conversations** (6C). Calls stay the conversation workplace.
9. **Owner language:** train, line, receptionist. Not “compile prompt”, not “system prompt”, not “LLM”.
10. **Primary framing:** managing a receptionist. Secondary: teaching them the business. Never: configuring an AI.

### Owner mental model (question 20)

| Framing | Verdict |
| --- | --- |
| Configure my AI | Reject. Sounds like a developer console |
| Train my receptionist | **Primary.** Matches Settings job line: “Teach and configure the receptionist.” Matches Import/Test |
| Set up what my receptionist can do | **Secondary**, as the outcome of Train (tools, hours, catalog), not as a capability matrix title |

Use “Train my receptionist” for the Business page job. Use “what they can do” only as explanation-free labels on existing Tools/handoff controls if Phase 7 retitles them.

---

## 22. Conceptual architecture

```text
┌─────────────────────────────────────────────────────────────┐
│ BUSINESS                                                    │
│  name, type/pack (defaults), hours, places, catalog,        │
│  FAQs, bulletin, policies, notify, wallet (ops, not spoken) │
└───────────────┬──────────────────────────┬──────────────────┘
                │                          │
                ▼                          ▼
        KNOWLEDGE                      POLICY
        (facts to say)                 (rules to obey)
                │                          │
                └────────────┬─────────────┘
                             ▼
                      CAPABILITY
                      (actions allowed)
                      inferred from pack +
                      tools + filled knowledge
                             │
                             ▼
                    RECEPTIONIST
                    identity | configuration
                    readiness | line state
                             │
                             ▼
                      CONVERSATION
                      (always: calls)
                             │
              ┌──────────────┼────────────────┐
              ▼              ▼                ▼
           no work     CUSTOMER WORK      HANDOFF now
           (answered)  optional           (escalate)
                             │
                             ▼
                      SCHEDULE?
                      optional when/window/place
```

**One sentence:** The business teaches the receptionist; the receptionist finishes the call or leaves the owner a piece of work, sometimes with a time, sometimes with a tap on the shoulder.

---

## 23. MVP boundary

Ruthless. What Scalers must actually have for a Kenyan SME receptionist.

### MVP (already mostly shipped; gaps are Brain/Train completeness, not new objects)

- Business fields listed in §3 (no new columns)
- Four packs as **defaults** (hospitality playbook may stay empty)
- Universal answer + lead-save + optional request + optional schedule + escalate
- Work creation policy: no row for answered information
- Thin schedule: `when_text` + landmark for visits
- Handoff: callback notify; never fake transfer
- Auto en/sw/sheng
- Readiness: Line live / Number pending / Needs training
- Receptionist identity from existing Train + Test + Home strip
- Routes and tables unchanged

### Not MVP (even if competitors have them)

- CRM, pipelines, lifecycle stages
- Enterprise workflow / automation builder
- Dispatch, skills, routing optimization
- Resource / staff / chair / room diary
- Duration and capacity engines
- Customer portal / Client Hub
- Omnichannel orchestration (this product is voice-first; WhatsApp is notify, not a second receptionist)
- Medical, legal, or pharmacy clinical modes
- New vertical enums without playbooks
- Owner capability matrix
- Seventh nav item
- Unified work table (6C F)

---

## 24. Deferred capabilities

| Item | Phase-ish | Owner |
| --- | --- | --- |
| Hospitality playbook (reservation slots: party size) | When Brain takes the empty pack | Brain |
| Owner-visible capability defaults inferred from vertical (still not a matrix) | After dual-write risk is owned | Brain + Desk copy |
| `quote` as first-class work type | After 6C type exists | Platform + Brain |
| Display aliases in empty states (Visit vs Appointment) | Copy PR, keep URLs | Desk |
| Agent Persona retitle / grouping on Test + Home | **Phase 7** | Desk |
| Structured catalog during onboarding | Only if retail activation data shows Train is too late | Desk, no extra nav |
| True availability / staff | Platform-sized | Platform |
| Live transfer executor | Voice | Voice |
| Local languages beyond en/sw/sheng | Voice | Voice |
| Recurring jobs | Far | Brain/Platform |
| OMS orders, payments, stock decrement | Never unless commerce becomes the product | — |
| Physical merge of request/appointment tables | 6C: Platform approval | Platform |
| Home mix of open work | After product asks | Desk |
| Send-followup workflows | Never as an owner canvas | — |

---

## 25. Final recommendation

Adopt **business → knowledge / policy / capability → receptionist → conversation → optional work → optional schedule**, with **optional immediate handoff**.

1. **Business type = F:** prompt hint + default capabilities. Not a workflow engine. Not an intent CMS.
2. **Packs = overridable defaults**, not hard-coded product modes. Prefer flexible defaults.
3. **Capabilities, not vertical apps.** Overlap is allowed.
4. **Keep knowledge, policy, and capability separate.**
5. **Smallest capabilities:** answer, save a lead, capture unfinished work, schedule a requested time, hand off. Infer them. Do not draw a matrix.
6. **Work policy:** persist only unfinished promises. Never because a call happened.
7. **Schedule:** spoken when + visit landmark. No diary.
8. **Handoff:** now vs later. Never claim live transfer.
9. **Receptionist entity:** existing fields only. Status labels remain Line live, Number pending, Needs training.
10. **Owner frames:** train the receptionist by teaching the business.
11. **No UI, schema, or Brain changes in this phase.**

```text
RECOMMENDED SCALERS BUSINESS CONTEXT

Owner configures a business (facts, rules, pack).
System infers receptionist capabilities.
Receptionist answers from knowledge, obeys policy,
acts only with authorized tools.

Caller speaks naturally (en / sw / sheng / mix).
System infers operational intent.
No software nouns required.

Conversation always persists.
Customer work persists only if unfinished.
Schedule is optional on that work.
Human handoff is immediate or later, not both by default.

Vertical packs change defaults and words.
They do not fork the product.
```

---

## 26. Phase 7 proposal

Phase 7 should remain Desk language and grouping **on existing surfaces**. It must not implement this model in schema or tools.

In scope for a later Desk PR (still no seventh tab, no TenantForm split unless impossible otherwise):

1. Retitle Train “Agent Persona” toward receptionist identity without changing compile ([`pages/settings.md`](./design-system/pages/settings.md)).
2. Group Test + Home strip so the receptionist feels like one person (name, voice preview, line, readiness gaps).
3. Page-spec notes: Requests = unscheduled work view; Appointments = scheduled work view (6C leftover copy, URLs unchanged).
4. Empty-state words that match pack aliases (Hold / Visit / Reservation) **if** a copy PR is approved. No new IA.
5. Coordinate with Brain (separate PR, not Desk) on: no work for answered information; reduce dual-write of appointment+request when the pack does not use both.

Out of scope for Phase 7:

- Redesign Business, Home, Calls, Requests, Appointments
- Capability matrix
- Onboarding extra steps
- Hospitality engine
- Schema merge
- Receptionist route

**Phase 7 readiness:** **READY** for a language/grouping Desk pass on existing Test + identity + Home strip. **BLOCKED** for any capability or playbook behavior change until Brain owns it.

---

## Sources

Prefer official docs. Weak sources marked.

**Support / knowledge vs work**

- Intercom, [Tickets explained](https://www.intercom.com/help/en/articles/6436600-tickets-explained)
- Intercom, [Building Fin Procedures](https://www.intercom.com/help/en/articles/13449439-building-fin-procedures) (handoff to ticket vs teammate)
- Intercom, [Overview of content types](https://www.intercom.com/help/en/articles/9357928-overview-of-content-types-and-when-to-use-them)
- Zendesk, [From support requests to tickets](https://support.zendesk.com/hc/en-us/articles/4408881925786-Lesson-1-From-support-requests-to-tickets)

**Scheduling / field service (capabilities, not vertical apps)**

- Square, [Booking object](https://developer.squareup.com/reference/square/objects/Booking)
- Square, [Bookings API concepts](https://developer.squareup.com/docs/bookings-api/get-ready-to-use-the-api)
- Jobber, [Requests and Bookings Settings](https://help.getjobber.com/hc/en-us/articles/39026037947543-Requests-and-Bookings-Settings)
- Jobber, [Work Settings](https://help.getjobber.com/hc/en-us/articles/115009737088-Work-Settings)
- Jobber, [Workflow overview](https://help.getjobber.com/hc/en-us/articles/360056046054-Jobber-Workflow-Overview)
- Salesforce, [WorkOrder](https://developer.salesforce.com/docs/atlas.en-us.field_service_dev.meta/field_service_dev/sforce_api_objects_workorder.htm)
- Salesforce, [ServiceAppointment](https://developer.salesforce.com/docs/atlas.en-us.object_reference.meta/object_reference/sforce_api_objects_serviceappointment.htm)
- Microsoft, [Field Service architecture](https://learn.microsoft.com/en-us/dynamics365/field-service/field-service-architecture)
- Microsoft, [Universal Resource Scheduling](https://learn.microsoft.com/en-us/dynamics365/field-service/universal-resource-scheduling-for-field-service)

**Leads vs work**

- HubSpot, [Lifecycle stages](https://knowledge.hubspot.com/records/use-lifecycle-stages) (evidence that “lead” is a CRM state; Scalers keeps it on `calls.lead_status`)

**Repo (authoritative for current behavior)**

- `src/prompts.js`, `src/conversation/brainPolicy.js`, `src/conversation/languageOptions.js`, `src/conversation/playbooks/*`, `src/conversation/liveKnowledge.js`, `server.js` runtime capability flags
- `dashboard/src/lib/vertical.ts`, `handoffMode.ts`, `mvpAnswerReadiness.ts`, `onboarding/OnboardingWizard.tsx`
- `docs/supabase/schema.sql` and related tenant SQL
- [`CUSTOMER_WORK_MODEL.md`](./CUSTOMER_WORK_MODEL.md), [`pages/receptionist.md`](./design-system/pages/receptionist.md), [`pages/settings.md`](./design-system/pages/settings.md), constitution §9–10

Competitor features above are **evidence**, not requirements. Scalers does not inherit Jobber automations, Square staff diaries, or Intercom Fin procedures UI.
