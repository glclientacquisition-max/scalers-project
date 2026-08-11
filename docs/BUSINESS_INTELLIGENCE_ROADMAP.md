# Business Intelligence Roadmap — From Generalist Receptionist to Full-Assist Employee

> **Status:** In progress — Phase 0 foundations landing (vertical, handoff, locations, policies, full-assist prompt job)  
> **Goal:** The AI can understand a business end-to-end and fully assist ~95% of callers with no extra human input  
> **Beachheads:** Retail → Home services (immediately after) → Hospitality (hotels) later  
> **Codebase baseline:** current `main` (SautiKit media + Gemini + Supabase tenants knowledge + desk compile)

---

## 1. Problem statement

Today Scalers is a **strong multilingual generalist receptionist**:

- Answers from injected business facts (hours, services, FAQs, bulletin)
- Captures name + reason
- Notifies owner (WhatsApp/email)
- Optionally escalates async / ends the call

That is **not** full assistance. Callers (and owners) want the agent to finish the job: product questions, prices, directions, holds/orders, bookings, policies — and only involve a human when the business truly needs one.

**Success metric (north star):**

```text
fully_resolved_rate =
  calls where the caller’s intent was completed by AI
  (answer + action + clear next step)
  / all handled calls

Target: ≥ 95% on beachhead vertical after pack + tools ship
```

Escalate / callback is counted as success **only** when the intent genuinely required a human (per playbook rules), not when the AI lacked knowledge or tools.

---

## 2. Actuality — how the system works today

This roadmap is constrained by (and builds on) the real stack. Do not plan as if RAG, CRM, or booking already exist.

### 2.1 Intelligence path (live call)

```text
Desk structured fields on tenants.*
  → Gemini/local compileReceptionistPrompt
  → tenants.llm_system_prompt

Voice: getTenantProfile(DID/call)
  → buildSystemPrompt(profile):
       1. CONTEXT HEADER     (EAT clock, open/closed, bulletin, identity)
       2. LIVE GROUND TRUTH  (services_catalog, faqs, team, unknown line)
       3. llm_system_prompt  (compiled prose)
       4. CONVERSATION_RULES + language policy
       5. Tool marker instructions
  → Gemini turn → spoken text + ###TOOL### / ###ENDCALL### markers
```

**Key files:**

| Layer | Path |
| --- | --- |
| Prompt assembly | `src/prompts.js` |
| Live facts | `src/conversation/liveKnowledge.js` |
| Hours / open | `src/conversation/businessHours.js` |
| Bulletin | `src/conversation/dailyBulletin.js` |
| Tools parse | `src/conversation/agentTools.js` |
| Escalation | `src/conversation/escalation.js` |
| Profile load | `src/db.js` → `getTenantProfile` |
| Marker side-effects | `server.js` (`save_caller_info`, escalate, end_call) |
| Desk compile | `dashboard/src/lib/promptCompiler.ts` |
| Save+compile | `dashboard/src/app/(desk)/settings/actions.ts` |
| Ingest | `dashboard/src/lib/ingest/**`, `settings/ingestActions.ts` |
| Onboarding | `dashboard/src/app/onboarding/**` |

### 2.2 What knowledge exists (almost all on `tenants`)

| Field | Role today |
| --- | --- |
| `business_name`, `agent_name`, `agent_tone` | Identity / persona |
| `hours_schedule`, `business_hours`, `after_hours_mode` | Open/closed + serve vs message |
| `services_catalog`, `services_offered` | Offer list (catalog is live ground truth) |
| `faqs` | Golden Q/A (desk max ~25) |
| `team_directory` | Async escalate routing |
| `daily_bulletin` | Temporary overrides |
| `unknown_answer_fallback` | Exact “we don’t do that” line |
| `agent_tools` | `{ escalate, end_call }` toggles |
| `llm_system_prompt` | Compiled system prompt (owners do not edit raw) |

**Not implemented (blueprint debt):** `knowledge_chunks`, embeddings, mid-call RAG, native function calling, calendar, contacts/CRM tables, inventory, booking tools.

### 2.3 Tools today (thin)

| Tool | Mechanism | Effect |
| --- | --- | --- |
| `save_caller_info` | `###TOOL###` JSON | Writes name/reason into `calls.summary`; WhatsApp/email alert |
| `escalate` | markers | Async notify teammate/owner — **not** live transfer |
| `end_call` | `###ENDCALL###` | Hang up after goodbye |

Job contract in prompts is still essentially: **answer from knowledge → name → reason → confirm → goodbye**.

### 2.4 Desk surfaces today

Settings (`/settings`): **Today → Import → Train → Test**

- Bulletin, URL/paste ingest, services catalog, hours, FAQs, team, tools
- Calls inbox: lead status, transcript, FAQ suggestions from transcript
- Onboarding wizard: free-text services + hours + tone only — **does not** fill structured `services_catalog` / `hours_schedule` / FAQs

### 2.5 Exact gaps blocking 95% full assist

1. **No Business Operating Model** — knowledge is JSON blobs + one prompt, not entities + policies + playbooks  
2. **Job is lead-capture centric** — prompts/tools optimize for callback, not completion  
3. **No system of record for work** — no contacts, requests, holds, appointments  
4. **No retail/home-services playbooks** — one generalist path for all industries  
5. **Onboarding incomplete** — prose wizard ≠ trained employee  
6. **Handoff not configurable for live transfer** — escalate = WhatsApp/email only  
7. **Learning loop weak** — FAQ suggestions exist; no continuous gap→approve→retrain loop  
8. **No vertical packs** — default demo knowledge is home-services flavored, but product is generic  

---

## 3. Destination architecture

### 3.1 Four layers

```text
1. Business Brain     — canonical facts, policies, catalog, locations
2. Intent Playbooks   — how each caller job gets finished
3. Action Tools       — write to Scalers CRM/calendar; later integrations
4. Learning Loop      — unresolved → gap → owner approve → model updates
```

### 3.2 Platform vs vertical packs

```text
Core platform (every business)
  identity, locations/directions, hours, policies
  catalog (products or services), FAQs, contacts
  handoff mode (callback | live_transfer)
  learning loop, EN/SW/Sheng voice

Vertical packs (completion logic)
  Retail          ← Phase 2 (first)
  Home services   ← Phase 3 (immediately after)
  Hospitality     ← Phase 4+ (hotels/lodges/restaurants)
  Logistics / Salon / Clinic ← later
```

**Hotels are not retail.** They sit under **Hospitality** (room nights, dates, rates, amenities). They reuse the booking spine built for home services, then add stay-specific slots.

### 3.3 Own thin systems of record (v1 decision)

We do **not** have Scalers calendar/CRM today. To finish calls we will **own thin tables first**, integrate Google Calendar / external CRM later.

| Object | Purpose |
| --- | --- |
| `contacts` | Caller memory across calls (phone, name, notes) |
| `service_requests` / `orders` | Retail holds, enquiries, pickup reserves |
| `appointments` | Home services (then hospitality) bookings |
| `business_locations` | Directions, landmarks, branches |
| `business_policies` | Returns, deposits, cancellation, delivery rules |
| `knowledge_documents` + chunks | Optional corpus beyond FAQ ceiling (Phase 2b+) |

### 3.4 Handoff (per business)

```text
handoff_mode:
  callback       — WhatsApp/email (default; works today)
  live_transfer  — warm/bridge transfer when telephony supports it
```

Ship `callback` hardening first; add `live_transfer` when SautiKit transfer primitives are wired. UI toggle on Train settings next to `agent_tools`.

### 3.5 Resolve contract (every playbook)

1. If knowledge has the answer → **speak it**  
2. If a tool can complete the job → **do it** and confirm  
3. If confidence low → **one** clarifying question  
4. If still blocked → **structured escalate** with full context  
5. Never invent price, stock, availability, or policy  

---

## 4. Phased roadmap

Phases are sequenced so each one is shippable on the current architecture without boiling the ocean. Lane ownership noted; schema/RPC changes go **Platform first**.

---

### Phase 0 — Foundations (platform core, all verticals)

**Outcome:** Any business can be modeled more completely; calls stop being “message only” by default; we can measure resolution.

#### 0A. Business Operating Model (schema + db surface)

**Platform owns SQL + `src/db.js`.**

Add additive migrations (do not break existing `tenants` columns):

| New / extended | Why |
| --- | --- |
| `tenants.vertical` | `retail` \| `home_services` \| `hospitality` \| `general` |
| `tenants.handoff_mode` | `callback` \| `live_transfer` |
| `business_locations` | address, landmark, geo notes, branches |
| `business_policies` | keyed policy text (returns, delivery, deposit, warranty…) |
| `contacts` | `tenant_id`, phone E.164, name, last_reason, meta |
| `service_requests` | retail/home “work objects” before full appointments |
| Extend `services_catalog` item shape | `category`, `sku`/`code`, `in_stock` (bool/unknown), `unit` — keep backward compatible |

**Voice:** `getTenantProfile` returns locations + policies + vertical + handoff into live ground truth.

**Invariant:** Prefer expanding `src/db.js` behind stable names; service role stays server-only.

#### 0B. Rewrite the call job (Brain)

Change default job in `src/prompts.js` + `PROMPT_COMPILER_SYSTEM` from:

> answer → name → reason → callback goodbye  

to:

> identify intent → resolve via playbook/knowledge/tools → confirm outcome → only then goodbye  
> capture contact continuously; escalate only per playbook  

Keep: ≤25 words/turn, no invention, EN/SW/Sheng match, name accuracy rules.

#### 0C. Structured outcomes (not only `summary` blob)

Extend call outcome model (Platform + Brain):

- `primary_intent` (enum/string)
- `resolution` = `resolved` \| `needs_human` \| `abandoned` \| `unknown`
- `resolution_note` (short)
- Keep existing `calls.summary` for compatibility; add columns or structured JSON keys carefully

Desk: show resolution on call detail; power the 95% metric.

#### 0D. Deep one-time onboarding (Desk + Brain)

Replace/extend 3-step prose wizard with **vertical-aware training** (length OK if one-time):

1. Business type (retail / home services / other)  
2. Locations + landmarks + directions phrasing  
3. Catalog (products or services) — structured, not only prose  
4. Hours schedule (write `hours_schedule`, not only text)  
5. Policies (returns/delivery or deposit/warranty)  
6. Top FAQs  
7. Team + handoff mode  
8. Compile + test call  

**Must fix today’s gap:** onboarding writes structured catalog/hours/FAQs/locations — same fields Train uses — so voice live ground truth is populated immediately.

Reuse: `KnowledgeIngestPanel` extract pipeline during onboarding (paste/URL).

#### 0E. Learning loop v1

Build on `CallFaqSuggestions`:

- Auto-queue gaps from: `unknown` resolutions, escalations, “I don’t know” turns  
- Owner one-tap: approve FAQ / catalog row / policy  
- Recompile prompt  
- Metric dashboard: resolved rate, top unresolved intents  

#### 0F. Definition of done (Phase 0)

- [ ] New tenant completes deep onboarding → structured fields populated  
- [ ] Live ground truth includes locations + policies  
- [ ] Call writes `resolution` + `primary_intent`  
- [ ] Desk shows simple resolved-rate for last 7 days  
- [ ] Handoff mode stored; `callback` path unchanged/hardened  
- [ ] No regression: existing tenants still load; smoke compile + test call  

---

### Phase 1 — Retail pack (first beachhead)

**Outcome:** A retail shop’s AI can fully assist most callers: hours, directions, catalog/price, availability (from catalog), hold/pickup request, policies, human handoff.

#### 1A. Retail knowledge shape

Extend catalog model (Desk `servicesCatalog.ts` + live formatter):

```text
product:
  name, category, price_range | price, unit,
  in_stock: yes | no | unknown,
  notes, aliases[], out_of_scope
```

Add retail policy keys: returns, exchanges, delivery_areas, payment_methods, hold_duration.

Locations: landmark-first directions (Kenyan phone UX).

#### 1B. Retail intent playbooks (Brain)

Implement playbook router (new module under `src/conversation/playbooks/`):

| Intent | Required slots | Completion action |
| --- | --- | --- |
| `hours_open` | — | Answer from hours/bulletin |
| `directions` | branch if multi | Answer landmark/directions |
| `product_inquiry` | product | Answer from catalog; never invent |
| `price` | product | Answer price_range/price or unknown line |
| `availability` | product | Answer `in_stock` or unknown → offer hold/request |
| `hold_or_pickup` | product, name, when | Create `service_requests` row + notify |
| `order_enquiry` | product, qty, name | Create request; set expectations |
| `policy` | policy key | Answer from policies |
| `human` | name, reason | Handoff per `handoff_mode` |
| `other` | name, reason | Capture + resolve or escalate |

Prompt compiler gains a **Retail job section** when `vertical = retail`.

#### 1C. Tools for retail completion

Add tools (marker-based first, same pattern as `save_caller_info` in `server.js`; extract parsers to `src/conversation/`):

| Tool | Writes | Notify |
| --- | --- | --- |
| `upsert_contact` | `contacts` | — |
| `create_service_request` | `service_requests` (type: hold/enquiry/order) | Owner WhatsApp/email |
| `save_caller_info` | keep (compat / lead mirror) | existing |
| `escalate` | existing | existing |
| `end_call` | existing | — |

**Desk:** Requests inbox (or Calls sub-tab) — open holds/enquiries, mark fulfilled.

#### 1D. Retail onboarding pack

Guided checklist + optional website ingest tuned for retail (products, prices, return policy). Seed starter FAQs (hours, M-Pesa, parking/directions, holds).

#### 1E. Retail excellence bar (exit criteria)

On a trained retail tenant, AI can complete without human:

- Open/closed + directions  
- “Do you sell X / how much?” from catalog  
- “Do you have X in stock?” when `in_stock` known  
- “Hold two for me, I’ll pick up at 5” → request created + owner notified  
- Returns/delivery policy answers  
- Unknown product → unknown line + capture request (not hallucination)

**Measure:** ≥ 80% resolved on retail test script (manual + scenario smoke), then climb toward 95% via learning loop.

#### 1F. What we explicitly defer in Retail v1

- Live POS/inventory sync  
- Online payment on the call  
- Multi-warehouse logistics  
- Full e-commerce cart  

Stock is **owner-maintained catalog truth** (+ bulletin for “out of stock today”).

---

### Phase 2 — Home services pack (immediate next)

**Outcome:** Same platform; visit booking and job requests complete on-call.

Depends on Phase 0 contacts + Phase 1 request patterns; adds calendar.

#### 2A. Appointments system of record (Platform)

```text
appointments:
  tenant_id, contact_id, service_name,
  window_start, window_end (or date + time_preference text),
  address/landmark, status (requested|confirmed|cancelled|done),
  notes, source_id
```

Desk: simple calendar / list + confirm/cancel.  
Optional later: Google Calendar sync (do not block v1).

#### 2B. Home services playbooks

| Intent | Completion |
| --- | --- |
| `service_inquiry` / `price_band` | Catalog + “quote on site” rules |
| `service_area` | Areas list; outside → capture / decline honestly |
| `book_visit` | Collect service, time window, location, name → `appointments` |
| `reschedule` / `cancel` | Update appointment |
| `emergency` | Policy: note urgency + handoff rules |
| `directions` to depot / “we come to you” | Locations + policies |
| `human` | Handoff mode |

Reuse retail tools; add `create_appointment`, `update_appointment`.

#### 2C. Catalog shape for services

Keep `services_catalog`; emphasize `price_range`, lead time in `notes`, `out_of_scope`, service areas on tenant or policy.

#### 2D. Exit criteria

Trained home-services tenant: book a visit with service + time + landmark + name; answer area/price bands; escalate true emergencies per policy. Resolved-rate tracked same as retail.

---

### Phase 3 — Hospitality pack (hotels) — after home services

**Why later:** Needs booking spine (Phase 2) + stay-specific inventory (room types, date ranges, rates, cancellation).

| Intent | Needs |
| --- | --- |
| Availability on dates | Room inventory / calendar |
| Rate / meal plan | Rate rules |
| Book reservation | Appointments-like `reservations` |
| Amenities / check-in / directions | Policies + locations |
| Late arrival | Policy + bulletin |

**Until then:** hotels can use **general/core** (hours, directions, FAQs, “leave a booking request” via `service_requests`) — useful, not 95%.

---

### Phase 4 — Scale quality to 95% (cross-vertical)

1. **Gap mining** — weekly top unresolved intents per tenant/vertical  
2. **Raise FAQ/catalog ceilings** carefully; add `knowledge_documents` + chunk retrieve **at call setup only** if prompt size breaks (architecture blueprint RAG phase — not mid-turn for latency)  
3. **Live transfer** — implement when `handoff_mode = live_transfer` and SautiKit supports bridge/transfer  
4. **Caller memory** — greet returning numbers from `contacts`  
5. **Scenario smokes** — extend `scripts/smoke-escalation-scenarios.js` pattern to retail/home playbook scripts  
6. **Vertical template library** — starter catalogs/FAQs/policies per vertical  
7. **Optional integrations** — Google Calendar, Shopify/stock, tracking APIs — only after owned thin SoR works  

---

## 5. Build order (engineering sequence)

Concrete sequence that respects current lanes and deploy split (voice Railway/Render, desk Vercel):

| Step | Work | Lanes |
| --- | --- | --- |
| 1 | SQL: vertical, handoff_mode, locations, policies, contacts, service_requests | Platform |
| 2 | `src/db.js` load/write helpers; voice profile mapping | Platform |
| 3 | Live ground truth + prompt job rewrite + outcome fields | Brain (+ Platform columns) |
| 4 | Deep onboarding + Train UI for new fields | Desk + Brain |
| 5 | Retail playbooks + `create_service_request` tool + desk requests inbox | Brain + Desk + Platform |
| 6 | Learning loop queue + resolved-rate UI | Brain + Desk |
| 7 | Appointments SQL + tools + desk calendar | Platform + Brain + Desk |
| 8 | Home services playbooks + onboarding pack | Brain + Desk |
| 9 | Hospitality pack | same pattern |
| 10 | Live transfer + external integrations | Voice/Platform + Ops as needed |

**Do not** parallel-edit `server.js` heavily across agents; extract tool parsing into `src/conversation/` as tools grow (Brain contract).

---

## 6. Mapping roadmap → current files (change list)

| Capability | Extend / add |
| --- | --- |
| Live facts | `src/conversation/liveKnowledge.js` |
| Playbooks | `src/conversation/playbooks/retail.js`, `homeServices.js`, router |
| Prompt job + tools instructions | `src/prompts.js`, `dashboard/src/lib/promptCompiler.ts` |
| Tool execution | extract from `server.js` → `src/conversation/tools*.js`; keep markers initially |
| Profile API | `src/db.js` |
| Schema | `docs/supabase/*.sql` (additive) |
| Onboarding | `dashboard/src/app/onboarding/**`, `lib/onboarding.ts` |
| Train form | `dashboard/src/components/TenantForm.tsx`, settings actions |
| Ingest | `dashboard/src/lib/ingest/**` (retail-tuned extract schema) |
| Requests / calendar UI | new desk routes under `(desk)/` |
| FAQ learning | `calls/faqActions.ts` → generalize to gap queue |
| Metrics | desk home or settings insights |
| Handoff | `agent_tools` / new `handoff_mode` + `src/conversation/escalation.js` + future Voice transfer |

---

## 7. Onboarding philosophy (agreed)

- One-time deep training is acceptable  
- Vertical pack drives the checklist  
- Website/paste ingest accelerates, **owner confirms** before compile  
- After onboarding, Today bulletin + Train remain the ops surface  
- Import/Train/Test stay; onboarding must write the **same structured fields**

---

## 8. Metrics & test strategy

### 8.1 Product metrics

| Metric | Source |
| --- | --- |
| Fully resolved rate | `calls.resolution` |
| Intent mix | `primary_intent` |
| Tool success rate | request/appointment created vs attempted |
| Escalation rate + reason | escalation + gap queue |
| Hallucination incidents | manual review / owner flags |
| Time-to-first-value | signup → first resolved call |

### 8.2 Engineering verification

- SQL: additive migrations; RLS owner isolation (`tenant_members`)  
- `npm run smoke:db` when env available  
- Playbook scenario scripts (retail + home)  
- Desk `lint` / `build`  
- Manual: onboard retail tenant → test call script (hours, directions, product, hold, policy, unknown)  
- Regression: existing generalist tenants without vertical still work (`vertical = general`)  

### 8.3 Retail test script (minimum)

1. “Are you open?”  
2. “Where are you / how do I find you?”  
3. “Do you sell [catalog item]? How much?”  
4. “Do you have [item] in stock?”  
5. “Hold one for me, name is …, pickup evening”  
6. “What’s your return policy?”  
7. “Do you sell [out of scope]?” → unknown line + offer take request  
8. “I want to talk to the owner” → handoff mode  

Home services script mirrors with book/reschedule/area/emergency.

---

## 9. Risks & non-goals

| Risk | Mitigation |
| --- | --- |
| Prompt context too large | Live ground truth stays structured/short; RAG chunks only at setup if needed; FAQ ceilings with retrieval later |
| Tool markers fragile | Keep markers short-term; extract parsers; consider native tools after media path stable |
| Owners won’t maintain stock | Bulletin + `in_stock=unknown` honesty; don’t claim live POS |
| Premature multi-vertical | Ship retail completion before hospitality |
| Parallel `server.js` edits | Extract conversation tools; one lane touches orchestration per PR |
| Scope creep into logistics/clinic | Core helps them; packs wait |

**Non-goals for Retail/Home v1:** full POS sync, M-Pesa checkout on call, medical advice, live courier tracking, replacing the owner’s entire back office.

---

## 10. Agreed product decisions (locked)

| Decision | Choice |
| --- | --- |
| v1 success | Full assist: resolve + act + clear next step |
| First vertical | **Retail** |
| Second vertical | **Home services** (immediately after) |
| Hotels | **Hospitality pack** after booking spine exists |
| Onboarding | Deep one-time OK |
| Calendar/CRM | **Own thin Scalers contacts + requests + appointments** first |
| Handoff | Per-business `callback` \| `live_transfer` |
| Knowledge approach | Structured ground truth + compile first; chunks/RAG only when needed |
| Invention | Never invent price/stock/availability/policy |

---

## 11. Implementation progress

| Slice | Status | Notes |
| --- | --- | --- |
| 1. SQL + `getTenantProfile` for vertical / handoff / locations / policies | **Done** | `docs/supabase/business_operating_model.sql` |
| 2. Live ground truth + full-assist prompt job | **Done** | `liveKnowledge.js`, `src/prompts.js`, compiler |
| 3. Desk Train + onboarding for new fields | **Done** | TenantForm + 4-step onboarding |
| 4. `contacts` + `service_requests` + `create_service_request` | **Done** | `contacts_and_requests.sql`, tool + `/requests` |
| 5. Retail playbook + richer requests UX | **Next** | Intent router / playbooks |
| 6. Appointments + home services pack | Next | |

**Apply migration:** run `docs/supabase/business_operating_model.sql` in Supabase SQL editor (grants included for authenticated updates).

---

## 12. Summary

| Now | Next | Then |
| --- | --- | --- |
| Generalist FAQ + lead capture on `tenants` JSON + compiled prompt | Core Business Operating Model + measurable resolution | **Retail pack** with holds/requests |
| Tools: save lead / async escalate / end | Contacts + service requests + playbooks | **Home services** appointments |
| Hotels unsupported as full-book | Core request-taking only | **Hospitality pack** on booking spine |
| Learning = FAQ suggestions | Gap queue → approve → recompile | Climb to **~95% fully resolved** |

This roadmap solves the real bottleneck: not “smarter wording,” but **business model + playbooks + systems of record + tools**, built on the compile/live-ground-truth architecture that already works in production paths today.
