# Scalers customer work model

**Status:** Phase 6C of Frontend 2.0. Research and recommendation only.  
**Date:** 2026-08-30  
**Lane:** Desk UI/UX (product architecture). Schema/tools remain Platform / Brain.  
**Authority:** [`FRONTEND_CONSTITUTION.md`](./FRONTEND_CONSTITUTION.md), [`NAVIGATION_RESEARCH.md`](./NAVIGATION_RESEARCH.md), [`FRONTEND_RECONNAISSANCE.md`](./FRONTEND_RECONNAISSANCE.md)  
**Does not authorize:** UI, route, CSS, package, schema, backend, or component changes.

This document answers one question:

> What is the smallest universal operational model that lets Scalers represent customer work across SME types without forcing every business into an appointment or request workflow?

It does not answer “how do we make Requests and Appointments prettier.”

**Conceptual only.** Nothing here is an implementation proposal until product and Platform approve it.

---

## 1. Executive summary

Requests and Appointments are **beachhead systems of record**, not universals.

They exist because the Business Intelligence roadmap chose **retail holds/orders** then **home-services visits** ([`HOME_SERVICES_PHASE2.md`](../HOME_SERVICES_PHASE2.md), [`contacts_and_requests.sql`](../supabase/contacts_and_requests.sql), [`appointments.sql`](../supabase/appointments.sql)). Phase 4 made those two lists *look* like Calls. That did not make them the right objects for a salon, a wholesaler, a lawyer, or a hotel.

The object Scalers should optimize around is:

> **The work the receptionist could not finish, that the owner still has to do, after a customer conversation.**

That is not every call. It is not a CRM lead. It is not an appointment unless time was actually committed.

**Recommended architecture (Model D):**

```text
Conversation (already: calls + transcripts)
        ↓
optional Customer work
        ├── type     (enquiry | hold | order | quote | visit | callback | other)
        ├── status   (open | done | cancelled)
        └── optional schedule (when, window, place, resource)
```

**Recommended MVP:** keep the two existing tables and two existing routes. Treat them as **views of one work concept** (unscheduled vs scheduled). Do not merge schema. Do not add Work as a seventh tab. Do not persist work for questions the receptionist already answered.

Weighted scores: D 8.55, F (keep tables, one concept) 8.00, B 7.55, A (current two peers) 5.20, E 5.40, C (forced pipeline) 4.90.

---

## 2. Why Requests + Appointments are problematic

They fail as a *universal* pair for five reasons.

1. **They encode two verticals as global IA.** `service_requests` is documented as “Retail/home work objects: holds, enquiries, order notes from voice.” `appointments` is documented as “Home-services visit bookings.” A pharmacy owner and a dentist are looking at the same two tabs. One of them is always a misfit.

2. **They are peers in nav but not peers in the world.** Phase 6A already ranked Appointments as secondary (More) and Requests as daily. That frequency split is a symptom: scheduling is a *mode* of work, not a second product.

3. **The same call facts are duplicated.** Both tables have `call_id`, `contact_id`, `caller_name`, `caller_phone`, `when_text`, `notes`, `status`. The difference is mostly “is this a visit with a service name and a window.” That is an attribute cluster, not a second genus.

4. **They force a workflow that many calls do not have.** “Mko na Samsung S25?” is catalog. “Do you deliver to Westlands?” is policy. Neither is a request or an appointment. Today those correctly stay on `calls`. The two extra destinations still *imply* that customer work lives there, so owners hunt the wrong list.

5. **“Request” is software English.** Kenyan SME owners talk about orders, bookings, jobs, quotes, callbacks. Jobber can use “Request” because it is a field-service OS and the next step is Quote or Job ([Jobber workflow](https://help.getjobber.com/hc/en-us/articles/360056046054-Jobber-Workflow-Overview)). Scalers is a receptionist. The handoff is “here is what I could not finish,” not “here is the first stage of a five-step FSM.”

The pair is not *wrong for the businesses that created it*. It is wrong as the **default ontology for every tenant**.

---

## 3. Current Scalers model

### What already exists

| Object | Table / field | Role today | Created by |
| --- | --- | --- | --- |
| Conversation | `calls` + `transcripts` | The interaction. Always persisted. | Voice on inbound |
| Lead state | `calls.lead_status` (`new` / `contacted` / `resolved` / `archived`) | Owner triage of the **call**, not of work | Default `new`; owner toggle |
| Assist outcome | `calls.resolution`, `primary_intent` | Whether the AI finished the intent | Brain |
| Contact | `contacts` | Phone-keyed caller memory | Voice on tools |
| Unscheduled work | `service_requests` types `hold` / `enquiry` / `order` / `callback` / `other`; status `open` / `fulfilled` / `cancelled` | Retail playbook `create_service_request` | Brain tool |
| Scheduled visit | `appointments` status `requested` / `confirmed` / `cancelled` / `done`; `service_name`, `when_text`, optional window, landmark | Home-services `create_appointment` | Brain tool |

Owner destinations: `/calls`, `/requests`, `/appointments`. Home Command Center shows **new call leads only** (constitution §10). Open requests and requested appointments are real data and are **not** on Home.

### What the voice agent actually hands the owner

Three layers, already in code:

1. **Every call** is a conversation record (and usually a “new” lead until the owner marks it).
2. **Some calls** also create a `service_request` (hold, order, enquiry, callback).
3. **Some home-services calls** create an `appointment` instead.

[`HOME_SERVICES_PHASE2.md`](../HOME_SERVICES_PHASE2.md) already states the split: keep `service_requests` for non-booking notes; appointments are the booking SoR. That is a **vertical packing decision**, later promoted into global nav.

### What the owner is asked to believe

The desk presents Requests and Appointments as peer workplaces equal to Calls. That is a stronger claim than the data model supports.

---

## 4. Business archetype analysis

Designed user remains a Kenyan SME owner. Archetypes below are **jobs the receptionist is asked to do**, not separate products.

| Archetype | Typical inbound | What the owner must receive | Fit of Request + Appointment as two peers |
| --- | --- | --- | --- |
| Appointment-heavy (salon, barber, clinic, dentist, gym, wellness, tutor) | Book / reschedule / cancel a named service with a person and a clock time | Confirmed (or requested) visit; not a generic “request” list | Appointment fits. Request is leftover retail. |
| Service/job-heavy (plumber, electrician, garage, cleaning, appliance, contractor) | “Nataka plumber leo,” quote, emergency | A **job** with a window and a place. May need a quote before a visit | Jobber’s Request → Job → Visit. Scalers Appointment is a thin visit, not a job. Request is an enquiry/callback dump. |
| Commerce-heavy (retail, electronics, wholesale, pharmacy, e-commerce) | Stock, price, hold, order, delivery | Hold or order note, or a resolved catalog answer | Request types already match. Appointment is noise. |
| Reservation-heavy (hotel, restaurant, travel, events) | Table/room for N people at a time | Capacity hold (party size, time), not a staff appointment | Neither tab is honest. “Appointment” implies a person. |
| Lead/consultation-heavy (lawyer, accountant, consultant, real estate, insurance, agency) | “Nataka kuongea na lawyer…” | A callback or consult slot. The “lead” *is* the call until a meeting is set | Dual lists over-structure a callback. |
| Education (school, tutor, training centre) | Fees, timetable, trial class, admission | Enquiry or a scheduled trial | Mixed. Trial class is a visit; fee question is not work. |
| General SME | Mix of the above, often on one line | Whatever the receptionist promised would happen next | Two fixed tabs teach the wrong taxonomy. |

**Transferable finding:** mature products specialize. Square Bookings is a time-bound service contract with staff and location ([Square Booking object](https://developer.squareup.com/reference/square/objects/Booking)). Jobber is a field-service workflow. Zendesk is a ticket for every support request. Scalers is none of those. Copying any one vertical’s *nouns* into global nav locks the others out.

**Do not split Scalers into vertical products.** Vertical packs already exist (retail playbook vs home-services playbook). The **object model** should stay one; **labels and available types** should follow the pack.

---

## 5. Customer intent taxonomy

Intents observed in playbooks, `primary_intent`, and common inbound calls.

| Intent | Universal? | Persist work? | Notes |
| --- | --- | --- | --- |
| Information (hours, location, “do you do X”) | Yes | **No** if answered from knowledge | Conversation only. `resolution=resolved`. |
| Price enquiry | Yes | No if a number exists; **yes** if “we’ll quote” | Quote is work only when the owner must produce a figure. |
| Availability (stock or diary) | Yes | No if answered; yes if hold/book | Same sentence, two outcomes. |
| Quote request | Common, not all | **Yes** | Type `quote`. Too early for a full quote object. |
| Service / job request | Service verticals | **Yes** | Type `visit` or `enquiry` until a time exists. |
| Booking / appointment | Time-boxed services | **Yes**, with schedule | Type `visit` + schedule. |
| Reservation (table/room) | Hospitality | **Yes**, with schedule + party/capacity | Same work object; different type label. Not a third entity. |
| Order | Commerce | **Yes** | Already `request_type=order`. |
| Hold / pickup | Commerce | **Yes** | Already `hold`. |
| Delivery question | Commerce | No if policy answers; yes if a delivery job is created | Policy vs work. |
| Callback | Yes | **Yes** | Already `callback`. |
| Complaint / support | Yes | **Yes** if owner must act | Type `other` or later `issue`. Do not import Zendesk. |
| Cancellation / reschedule | Scheduling verticals | Update existing work, do not spawn a sibling | Home-services `update_appointment` already does this. |
| Follow-up (“mliniahidi mnipigie”) | Yes | **Yes** if a promise exists | Often a callback, or the original call still `new`. |
| Lead / consultation | Professional | Call is the lead; work only if a consult is requested | See §9. |

**Merge for MVP:** booking, appointment, reservation, visit → one scheduled type (`visit`) with display aliases. Enquiry and information → information does not persist; enquiry persists only if unanswered. Order and hold stay distinct types (commitment vs reserve). Quote stays a type, not a document object.

**Too granular for MVP:** complaint vs support vs issue; delivery as its own entity; assessment vs job (Jobber); work-order line items; opportunities.

---

## 6. Request vs appointment

Do not use the dictionary. Use operational software.

### Salesforce Field Service (official)

Work orders are “work to be completed for your customers.” Service appointments “represent the visits your team makes to the field” and include arrival window, start/end, duration. A work order may have **multiple** appointments if more than one visit is needed. ([Field Service core data model](https://developer.salesforce.com/docs/atlas.en-us.field_service_dev.meta/field_service_dev/fsl_dev_soap_core.htm), [WorkOrder](https://developer.salesforce.com/docs/atlas.en-us.field_service_dev.meta/field_service_dev/sforce_api_objects_workorder.htm), [ServiceAppointment](https://developer.salesforce.com/docs/atlas.en-us.object_reference.meta/object_reference/sforce_api_objects_serviceappointment.htm).) Evidence: **high**.

**Transfer:** *what* vs *when/who*. **Do not transfer:** work types as templates, skills, dispatch board, multiple child appointments, billing line items.

### Microsoft Dynamics 365 Field Service (official)

“Field Service defines **what** needs to be done and **where**, while Universal Resource Scheduling defines **who** can perform the work and **when**.” A work order gets a resource requirement; booking it creates a Bookable Resource Booking. Work order statuses include Unscheduled → Scheduled → In Progress → Completed. ([Field Service architecture](https://learn.microsoft.com/en-us/dynamics365/field-service/field-service-architecture), [URS + work orders](https://learn.microsoft.com/en-us/dynamics365/field-service/universal-resource-scheduling-for-field-service), [work order vs booking status](https://learn.microsoft.com/en-us/dynamics365/field-service/work-order-status-booking-status).) Evidence: **high**.

**Transfer:** unscheduled work is still work. Scheduling is a later state, not a second inbox. **Do not transfer:** RSO, schedule board, bookable resources.

### Jobber (official, SME field service)

Workflow building blocks: Request → Quote → Job → Invoice. Requests are optional first capture. Jobs are the scope of work. **Visits** are calendar events on a job (“pizza and slices”). ([Workflow overview](https://help.getjobber.com/hc/en-us/articles/360056046054-Jobber-Workflow-Overview), [Request basics](https://help.getjobber.com/hc/en-us/articles/115009737048-Request-Basics), [Jobs in the app](https://help.getjobber.com/hc/en-us/articles/8185260991127-Jobs-in-the-Jobber-App).) Evidence: **high**.

**Transfer:** a request is *intake*, a visit is *a scheduled slice of work*. **Do not transfer:** quotes, recurring jobs, invoicing, assessments as a second booking type.

### Square Bookings (official)

A **Booking** is “a time-bound service contract” with location, customer, `start_at`, and `appointment_segments` (service + team member). Appointment is a **segment of a booking**, not a sibling of “request.” ([Booking object](https://developer.squareup.com/reference/square/objects/Booking), [Bookings API concepts](https://developer.squareup.com/docs/bookings-api/get-ready-to-use-the-api).) Evidence: **high**.

**Transfer:** when the product *is* scheduling, one booking object with segments is enough. **Do not transfer:** paid Appointments plan, staff availability inventory, as Scalers’ core.

### Intercom / Zendesk (support)

Intercom: conversations for quick queries; tickets when the issue is async, multi-step, or needs collaboration. Official: do **not** ticket every conversation. ([Tickets explained](https://www.intercom.com/help/en/articles/6436600-tickets-explained).) Evidence: **high**.

Zendesk: every support *request* becomes a ticket because Zendesk *is* a ticketing system. ([From support requests to tickets](https://support.zendesk.com/hc/en-us/articles/4408881925786-Lesson-1-From-support-requests-to-tickets).) Evidence: **high** for Zendesk; **do not transfer** “every inbound becomes work.” Scalers already persists every **call**. A second record is the Intercom ticket, not the Zendesk default.

### HubSpot (CRM)

Lead is a **lifecycle stage on a contact**, not a work object. ([Lifecycle stages](https://knowledge.hubspot.com/records/use-lifecycle-stages).) Evidence: **high**. Scalers already stores the analogous state on `calls.lead_status`. Do not add a Lead entity.

### Option analysis (this section’s question)

| Option | Verdict |
| --- | --- |
| A. Two independent top-level objects | What Scalers **ships**. Fits two beachheads. Fails as a universal. |
| B. Request → Appointment relationship | Jobber/Salesforce shape. Forces a pipeline even when the work *is* the appointment (salon) or *never* becomes one (hold). |
| C. One Work object with optional scheduling | Correct genus. Matches Dynamics “unscheduled work order.” |
| D. Conversation → Work → optional schedule | **Correct for Scalers.** Conversation already exists. Work is created only when needed. Schedule is optional on work. |
| E. Different models by vertical | Packs and labels, not different databases. Separate products rejected. |
| F. Calls + two physical tables as views of D | **MVP stance.** No schema merge until Platform agrees. |

---

## 7. Booking vs reservation

Consumer apps mix the words. Operations do not, quite.

Linguistic evidence (medium): English corpus work shows **appointment** collocates with dentist/doctor/hair (a person); **reservation** collocates with room/table/seat (capacity). ([Morimoto, HPU TESOL Working Papers, 2020](https://www.hpu.edu/research-publications/tesol-working-papers/2020/5_morimoto_corpus.pdf).)

Square (high): one Booking; appointment is a time segment with a staff member.

Hospitality (medium, no OpenTable public IA spec found): table for 10 on Friday is a **capacity reservation** (party size, duration, table), not a named stylist.

**Internal model:** one schedule cluster on work:

- when / window
- duration (optional)
- location or landmark
- resource: person **or** capacity (party size / room type)

**Display:** alias `visit` as Appointment, Booking, Reservation, Consultation, or Job by vertical pack. **Do not** create three entities. Weak evidence should not spawn tables.

---

## 8. Order vs request

Example: “Nataka cartons 20 za A4 paper.”

| Path | When it is true |
| --- | --- |
| Answered from catalog (“yes, 800 KES, pickup today”) | Conversation only. No work row. |
| Hold until pickup | Work type `hold` (already shipped). |
| Commitment to supply | Work type `order` (already shipped). |
| “We’ll check and quote” | Work type `quote` (not a type today; today it is `enquiry`). |

**Do not** model `request → order` as two records for MVP. That is Jobber’s Request → Job conversion, useful when a human qualifies intake. A receptionist either:

- finishes the order on the call (persist `order`), or
- cannot, and persists `enquiry` / `quote` for the owner.

Retail playbook already refuses to save a clean order for an unknown catalog title and logs an enquiry instead. That is the right lifecycle **as types on one object**, not a state machine across tables.

A full commerce **Order** (line items, payment, fulfillment) is **deferred**. Voice-captured `order` is a **note the owner must honour**, not an OMS.

---

## 9. Lead vs work

Scalers is not a CRM. Constitution: operating console for a receptionist.

| Concept | In Scalers today | Should be |
| --- | --- | --- |
| Lead | `calls.lead_status` on the conversation | **State of the call** (owner still needs to look / WhatsApp / archive) |
| Work | `service_requests` / `appointments` | **Promise or job the business must execute** |
| Contact | `contacts` | Memory keyed by phone. Not a lead object. |

HubSpot: Lead is a contact lifecycle stage. ([Official lifecycle stages](https://knowledge.hubspot.com/records/use-lifecycle-stages).)

A new call lead on Home is “someone rang; you have not triaged the **conversation**.” A plumber job is “you said you would send someone.” Mixing them on one list without types recreates the current confusion.

**Do not import** opportunities, MQL/SQL, or pipelines.

Professional-services “lead” (lawyer consult) is a **call** until the caller asks to book or be called back. Then it becomes work (`callback` or `visit`).

---

## 10. Conversation vs persistent work

This is the load-bearing distinction.

**Always persist:** the call (conversation). That is the system of record for “what happened.”

**Persist work only when** at least one is true:

1. The receptionist **committed the business** to an action the owner must complete (hold, order, visit, quote, callback).
2. The receptionist **could not finish** and explicitly handed off (`needs_human`, escalate, “owner will confirm”).
3. The caller **changed existing work** (cancel / reschedule) so the work row must update.

**Do not persist work when:**

- The question was answered from catalog, hours, FAQs, or policies.
- The caller hung up after information.
- The agent said goodbye with no promise.

Intercom’s official split is the analogue: chat for “How do I delete tags?”; ticket for “My bill is incorrect, issue a refund.” ([Tickets explained](https://www.intercom.com/help/en/articles/6436600-tickets-explained).)

Zendesk’s “every request is a ticket” is the **anti-pattern** for Scalers, because the call already *is* the request record. A second row is expensive: it clutters `/requests`, teaches the agent to over-save, and makes Home’s “new leads” compete with a junk work queue.

Brain already has `resolution` (`resolved` / `needs_human` / …). That flag plus tools should gate work creation. Today, over-creation is a playbook/discipline problem, not a missing table.

---

## 11. Industry research

| Industry | Central handoff | Schedule? | Scalers type |
| --- | --- | --- | --- |
| Salon / clinic / gym | Named service + staff + clock time | Required | `visit` |
| Plumber / garage | Job + window + landmark | Usual | `visit` or `enquiry` then `visit` |
| Retail / wholesale | Hold or order | Pickup `when_text` is not a staff diary | `hold` / `order` |
| Restaurant / hotel | Party or room + time | Required (capacity) | `visit` aliased Reservation |
| Lawyer / agency | Callback or consult | Optional | `callback` / `visit` |
| School | Fee/info vs trial class | Only the trial | Conversation vs `visit` |

Appointment-heavy businesses differ from ordinary work because **the scarce resource is a diary** (person, chair, room). Fields that belong *only* when scheduling: staff/resource, start, duration, availability, cancellation/reschedule policy. Service name, customer, and status belong on all work.

Commerce differs because **the scarce resource is stock or fulfillment**, not a calendar. Forcing an order into Appointments is a type error. Forcing a haircut into Requests without a time is how salons lose the plot.

---

## 12. Competitive models

| Product | Objects | Principle to steal | Principle to refuse |
| --- | --- | --- | --- |
| Salesforce FSL | Work order → Service appointment | What vs when | Dispatch, skills, many child visits |
| Dynamics FSL | Work order + booking | Unscheduled work is still work | URS, RSO, bookable resources |
| Jobber | Request → Quote → Job → Visit | Intake vs job vs calendar slice | Invoicing, recurring contracts |
| Square Bookings | Booking + appointment segments | One scheduled contract | Calendar product as the whole app |
| Intercom | Conversation; optional ticket | Don’t ticket trivia | Support-team collaboration model |
| Zendesk | Ticket = the work | Status lifecycle | Ticket-every-inbound |
| HubSpot | Contact + lifecycle | Lead is a state | Sales pipeline |
| ServiceNow | Incident / request / change | ITSM specialization | Enterprise workflow engines |

Evidence grades: official docs **high** for Salesforce, Microsoft, Jobber, Square, Intercom, Zendesk, HubSpot. ServiceNow mentioned only as a warning (ITSM nouns). No Field Service Lightning **implementation** is proposed.

---

## 13. Candidate Scalers models

### Model A. Requests + Appointments (current)

Two top-level objects, two routes, two tools.

### Model B. Customer Work with types

One work entity. Types include visit. No conversation layer in the model (calls remain implicit).

### Model C. Conversations → Requests → Appointments

Forced pipeline. Salon booking must pass through Request. Retail hold must look like it might become an Appointment.

### Model D. Conversations → Work (type, status, optional schedule)

Call always exists. Work is optional. Schedule is optional on work.

### Model E. Customer → Intent → Workflow

Abstract process engine. Owner cannot see “intent.” Voice would need a workflow runtime that does not exist.

### Model F. D as concept, A as storage (MVP)

Keep `service_requests` and `appointments`. Document them as unscheduled vs scheduled **views**. Same routes. No Work tab. Brain continues current tools.

---

## 14. Weighted decision matrix

Weights from the brief. Scores 1–10. Not fashion.

| Criterion | Wt | A Two peers | B One work | C Pipeline | D Conv→Work | E Intent | F Views of D |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Cross-industry fit | 25% | 4 | 8 | 5 | 9 | 6 | 8 |
| Owner comprehension | 15% | 6 | 7 | 5 | 8 | 3 | 8 |
| Voice-agent compatibility | 15% | 6 | 8 | 5 | 9 | 7 | 8 |
| MVP simplicity | 15% | 7 | 6 | 4 | 8 | 3 | 9 |
| Future scalability | 10% | 4 | 8 | 6 | 9 | 8 | 8 |
| Workflow flexibility | 10% | 4 | 8 | 5 | 9 | 8 | 7 |
| Data-model simplicity | 5% | 6 | 8 | 5 | 7 | 4 | 8 |
| UI simplicity | 5% | 5 | 8 | 4 | 8 | 3 | 7 |
| **Weighted** | | **5.20** | **7.55** | **4.90** | **8.55** | **5.40** | **8.00** |

### Score notes

**A Cross-industry 4.** Official SQL comments admit retail vs home-services. A hotel and a salon share the same two tabs.

**A Owner 6.** Beachhead owners already learned the words. New verticals will not.

**A Voice 6.** Two tools work; the agent must choose a table. Wrong table is a silent product bug.

**A MVP 7.** It is already shipped. Inertia is not fit.

**B MVP 6.** Needs a schema merge and a nav rename. Correct genus, expensive now.

**C Owner 5 / MVP 4.** Extra tap and extra record for salons. Intercom and Jobber both allow skipping intake.

**D Voice 9.** Maps to: save conversation always; `create_work(type, schedule?)` later as a single tool. Today’s two tools are a temporary encoding of type+schedule.

**D MVP 8.** Concept can land in docs and playbook policy without a migration. Physical merge is later.

**E Owner 3.** “Intent” and “workflow” are engineer words. Constitution: business nouns.

**F MVP 9.** No migration. Honest documentation. Risk: two UIs still *look* like two products until a later visual merge.

**Miller 7±2 is irrelevant here.** The issue is *wrong peers*, not *too many* nav items.

---

## 15. Voice-call test cases

Classification key:

- **Answered:** conversation only; no work row.
- **Owner action:** unscheduled work.
- **Scheduled:** work with schedule.
- **Lead/follow-up:** call stays `new` / callback work if a promise was made.

### Example 1. “Mko na Samsung S25?”

| Field | Value |
| --- | --- |
| Detected intent | Availability / catalog |
| Work required? | No if catalog answers; enquiry if unknown |
| Work type | (none) or `enquiry` |
| Scheduled? | No |
| State | Call `resolved` or work `open` |
| Owner action | None, or source the item |

### Example 2. “Nataka quotation ya 50 laptops.”

| Field | Value |
| --- | --- |
| Detected intent | Quote |
| Work required? | Yes |
| Work type | `quote` (today: `enquiry`) |
| Scheduled? | No |
| State | `open` |
| Owner action | Produce and send the quote |

### Example 3. “Nataka plumber leo.”

| Field | Value |
| --- | --- |
| Detected intent | Service request |
| Work required? | Yes |
| Work type | `visit` if window+landmark captured; else `enquiry` |
| Scheduled? | If a window was agreed |
| State | `requested` / `open` |
| Owner action | Confirm crew and time |

### Example 4. “Naweza kuja kesho saa nne?”

| Field | Value |
| --- | --- |
| Detected intent | Booking (caller comes in) |
| Work required? | Yes if the business takes walk-in slots |
| Work type | `visit` |
| Scheduled? | Yes (tomorrow 10:00) |
| State | `requested` until owner confirms |
| Owner action | Confirm or offer another slot |

### Example 5. “Book me for Friday at 2.”

| Field | Value |
| --- | --- |
| Detected intent | Booking |
| Work required? | Yes |
| Work type | `visit` |
| Scheduled? | Yes |
| State | `requested` / `confirmed` if diary is trusted |
| Owner action | Confirm; receptionist must not invent availability |

### Example 6. “Nataka kuongea na lawyer kuhusu kampuni yangu.”

| Field | Value |
| --- | --- |
| Detected intent | Consultation / lead |
| Work required? | Callback or consult slot, not a CRM opportunity |
| Work type | `callback` or `visit` |
| Scheduled? | Only if a time is set |
| State | Call remains a lead until work is saved |
| Owner action | Return the call or confirm the consult |

### Example 7. “Nataka table ya watu 10 Friday.”

| Field | Value |
| --- | --- |
| Detected intent | Reservation |
| Work required? | Yes |
| Work type | `visit` (label: Reservation) |
| Scheduled? | Yes + party size in details |
| State | `requested` |
| Owner action | Confirm table; not “create an appointment with a waiter” |

### Example 8. “Nataka ku-cancel appointment yangu.”

| Field | Value |
| --- | --- |
| Detected intent | Cancellation |
| Work required? | Update existing work; do not create a second row |
| Work type | existing `visit` |
| Scheduled? | Cleared / status `cancelled` |
| State | `cancelled` |
| Owner action | Usually none if the agent updated the row |

### Example 9. “Mliniahidi mnipigie jana.”

| Field | Value |
| --- | --- |
| Detected intent | Broken callback promise |
| Work required? | Yes if not already a `callback` |
| Work type | `callback` |
| Scheduled? | Overdue (attribute, not a new type) |
| State | `open`, urgent |
| Owner action | Call now |

### Example 10. “Do you deliver to Westlands?”

| Field | Value |
| --- | --- |
| Detected intent | Policy / area |
| Work required? | No if policy answers |
| Work type | (none) |
| Scheduled? | No |
| State | Call `resolved` |
| Owner action | None |

---

## 16. Universal concepts

| Concept | Universal? | Vertical-specific? | Entity / Attribute / State / Event | MVP? |
| --- | --- | --- | --- | --- |
| Conversation | Yes | No | Entity (`calls`) | Yes (exists) |
| Enquiry | Yes as unanswered ask | No | Work type | Yes as `enquiry` |
| Request | No as a genus | Name of unscheduled view | View, not a genus | Keep route |
| Appointment | No as a genus | Time-boxed services | Work type `visit` + schedule | Keep route |
| Booking | Alias of visit | Consumer wording | Display alias | Labels only |
| Order | Commerce-common | Commerce-primary | Work type | Yes (`order`) |
| Quote | Common | Stronger in B2B / wholesale | Work type | Map to `enquiry` until type exists |
| Callback | Yes | No | Work type | Yes (`callback`) |
| Follow-up | Yes | No | Call `lead_status` or callback | Do not add an entity |
| Reservation | Hospitality | Yes | Same schedule cluster; alias | Display only |
| Lead | Yes as call state | CRM-specific as an object | State on conversation | Yes (`lead_status`) |
| Schedule | Optional | Required in diary businesses | Attribute cluster | Yes (`when_text` / windows) |

Also universal: customer identity, source call, work status (open / done / cancelled).

---

## 17. Vertical-specific concepts

| Concept | Where it belongs | Entity? |
| --- | --- | --- |
| Staff / chair / room | Appointment-heavy | Attribute on schedule |
| Party size / table | Restaurant | Attribute |
| Room type / nights | Hotel | Deferred; not MVP |
| Line items / SKU / qty | Commerce | Attribute (`item`, `quantity` already) |
| Landmark / site | Field service | Attribute (`address_landmark` already) |
| Quote document | Professional / B2B | Type `quote` only for MVP |
| Recurring job | Cleaning / gym | Deferred (Jobber-shaped) |
| Assessment visit | Field service | Deferred |
| Ticket / incident | Support-centric firms | Deferred; use `other` |
| Opportunity / pipeline | CRM | Never for Scalers core |

---

## 18. Recommended conceptual model

**Conceptual only; not an implementation proposal until approved.**

```text
Conversation                    (calls + transcripts)
    │
    │  always
    │
    ▼
lead_status                     (new | contacted | resolved | archived)
resolution                      (resolved | needs_human | …)
    │
    │  only if the receptionist created a promise
    │  or could not finish
    ▼
Customer work                   (conceptual)
    ├── type                    enquiry | hold | order | quote | visit | callback | other
    ├── status                  open | done | cancelled
    ├── customer                name, phone, contact_id
    ├── source call             call_id
    ├── details                 item, quantity, notes, landmark
    └── schedule?               when_text, window_start/end, duration?, resource?
```

**Appointment** in this model is **work.type = visit with schedule present**, not a sibling of Request.

**Request** in this model is **work without a diary commitment** (or the historical name of the unscheduled view).

**Conversation relationship:** many work rows may theoretically point at one call; MVP keeps 0..1 as today.

---

## 19. MVP model

Ruthless. What a receptionist must hand an owner:

1. **The call** (always).
2. **At most one work note** when a promise or handoff exists.
3. **A time window on that note** when a visit/reservation was requested.

**Ship in data (already):** `calls`, `service_requests`, `appointments`, `contacts`.

**Do not ship in MVP:** unified `work` table, CRM pipelines, cases, tickets, work orders, resource scheduling, dispatch, quote PDFs, orders-as-OMS, vertical-specific apps.

**Brain MVP policy (no schema):** do not `create_service_request` for answered catalog/hours questions. Prefer updating an existing appointment on cancel/reschedule. Map “quote” to `enquiry` until a type exists.

**Desk MVP:** keep `/requests` and `/appointments`. No seventh tab named Work. No badges invented from counts.

---

## 20. Owner UX implications

Compare labels (not implemented):

| Label | Load | Verdict |
| --- | --- | --- |
| Requests / Appointments | Two products. Appointment-heavy owners ignore Requests; retailers ignore Appointments. | Current. Keep until a merge is approved. |
| Work | Accurate, slightly engineer-y in English. In KE, “work/kazi” is closer than “requests.” | Best **eventual** list title if one list. |
| Customer work | Architecture in the UI. | Reject for nav. |
| Follow-ups / Scheduled | Two views of D. Clear. “Follow-ups” collides with call `contacted`. | Possible **filters**, not new routes. |

Least explanation: **Calls** stay. A single operational list whose rows show type in business English (Hold, Order, Visit, Callback) needs no “what is a Request” tutorial. Until that list exists, do not rename the routes.

Empty states should eventually say what *this business* creates (holds vs visits), not a generic “service requests.” That is copy, not a new object. Out of scope for 6C implementation.

---

## 21. Receptionist implications

| Question | Under Model D |
| --- | --- |
| What does the receptionist know? | Knowledge pack (catalog, hours, services, policies). Not the work taxonomy. |
| What does it do? | Answer; or capture a promise; or escalate. |
| What customer work can it create? | Types allowed by the vertical pack (retail: hold/order/enquiry/callback; home services: visit + enquiry/callback). |
| What requires human follow-up? | Anything `needs_human`, plus all open work. |
| What can it schedule? | Visit/reservation **requests** with `when_text`. Not a live diary unless a later product proves availability. Home-services already forbids inventing booked status. |
| What can it complete automatically? | Information intents. Cancel/reschedule of a row it created. Not payment, not stock decrement. |

Knowledge should **gate types and slots**, not fork the architecture. A salon pack requires service + time; a retail pack requires catalog title + name for holds. Same work object, different required fields (already how playbooks work).

---

## 22. Navigation implications

**Do not change navigation in this phase.**

Eventual product:

| Item | Recommendation |
| --- | --- |
| `/requests` | **Keep** the URL. Conceptually the unscheduled-work view. Later: **merge visually** into one Work list with type filters, or keep as a filter deep-link. **Do not deprecate** bookmarks. |
| `/appointments` | **Keep** the URL. Conceptually the scheduled-work view. Later: **make contextual** (same list, schedule filter) or hide for commerce-only tenants **without deleting the route**. **Do not verticalize into a second app.** |
| New `/work` | Optional later alias. Not MVP. Not a seventh peer beside both old tabs. |
| Calls | Stay. Conversation workplace. |

Phase 6B already puts Appointments in **More** and Requests on the bar. That matches “schedule is secondary for mixed SMEs.” Do not reverse 6B because of this research. A future single Work list would occupy the Requests slot, not add a tab.

---

## 23. Home implications

**Do not redesign Home.**

Today: new **call** leads, what happened, line state, one next action.

Under D, “what needs me” is the union of:

1. New call leads (conversation triage). Already shipped.
2. Open work that is **actionable** (open holds, requested visits, overdue callbacks).

Do **not** dump all open requests onto Home until:

- counts are cheap and real (Phase 4 lists already have head counts),
- rows share Calls language (Phase 4 done),
- product asks (requests.md / appointments.md say wait).

When product asks, Home should mix **needs-action work**, not a second KPI tile. One queue, typed rows. Constitution order still holds: attention first, not a work-object tutorial.

“What happened” stays today’s calls. Completed work is not a Home feed.

“Next action” may become “confirm three visits” when that is the true bottleneck; until then, leave the derived CTA as-is.

---

## 24. Knowledge implications

Business knowledge should change **classification and slot-filling**, not the entity graph.

| Pack | Knowledge that changes work | Still one model? |
| --- | --- | --- |
| Plumbing | Areas, emergency policy, price bands, windows | Yes. Visit vs escalate. |
| Salon | Services, durations, staff, hours | Yes. Visit requires service + time. Availability **not** invented. |
| Retail | Catalog, prices, stock, delivery policy | Yes. Answer vs hold vs order vs enquiry. |

Intent classifiers already sit in playbooks (`retail.js`, `homeServices.js`). Adding types is a Brain pack change. Adding tables per vertical is how the current problem started.

---

## 25. Future expansion

Only after MVP discipline holds:

- `quote` as a first-class type (still one table conceptually).
- Capacity reservations (party size) on schedule.
- True diary / staff availability (Square-like). Platform-sized.
- Visual merge of the two lists.
- Home mix of open work.
- Recurring jobs (Jobber). Not soon.
- OMS-grade orders. Never unless commerce becomes the product.

---

## 26. Risks

| Risk | Mitigation |
| --- | --- |
| Owners already learned Requests / Appointments | Keep URLs and labels until a merge ships with redirects unused (bookmarks stay). |
| Silent schema merge | Forbidden without Platform. F documents the concept first. |
| Agent over-creates work | Playbook rule: no row if the intent was answered. |
| “Work” in the nav is jargon | Don’t put it in nav in MVP. Use type words in rows. |
| Appointment-heavy owners lose a calendar | Scheduled view / filter remains. The route stays. |
| Treating this doc as permission to rewrite `TenantForm` or playbooks | It is not. Brain/Platform own tools and SQL. |

---

## 27. What NOT to build

- CRM opportunities, pipelines, MQL/SQL
- Zendesk-style ticket-every-call
- Salesforce work-order line items, skills, dispatch
- Dynamics bookable resources / RSO
- Jobber invoicing, recurring contracts, assessments-as-a-product
- A `/work` tab beside Requests and Appointments
- Vertical forks of the desk
- Fake badges for open-work totals on nav
- Online / AI-active on work rows
- Receptionist tab (still inside Business / Home)

---

## 28. Final recommendation

Adopt **Model D** as the product architecture.

Execute **Model F** until Platform approves a physical merge: two tables, two routes, one concept.

The receptionist hands the owner **conversations**, and **only sometimes work**, and **only sometimes a time**.

Requests and Appointments remain **views**, not universals.

---

## 29. Proposed Phase 6D

Phase 6D should **not** merge tables or change routes.

Proposed 6D (Desk, copy/policy only, if product agrees):

1. Page-spec update: Requests = unscheduled work view; Appointments = scheduled work view. Same URLs.
2. Empty-state language that names real types (holds, orders, visits), no new IA.
3. Coordinate with Brain (separate PR) on “do not persist work for answered information calls.”
4. Still no Home mix, no Work tab, no schema, no receptionist global tab.

If 6D is receptionist language (Train/Test/Home strip), keep it **separate** from any work-list visual merge.

---

## Sources

Prefer official docs. Weak sources marked in place.

- Salesforce, [Field Service core data model](https://developer.salesforce.com/docs/atlas.en-us.field_service_dev.meta/field_service_dev/fsl_dev_soap_core.htm)
- Salesforce, [WorkOrder](https://developer.salesforce.com/docs/atlas.en-us.field_service_dev.meta/field_service_dev/sforce_api_objects_workorder.htm)
- Salesforce, [ServiceAppointment](https://developer.salesforce.com/docs/atlas.en-us.object_reference.meta/object_reference/sforce_api_objects_serviceappointment.htm)
- Microsoft, [Field Service architecture](https://learn.microsoft.com/en-us/dynamics365/field-service/field-service-architecture)
- Microsoft, [Universal Resource Scheduling for Field Service](https://learn.microsoft.com/en-us/dynamics365/field-service/universal-resource-scheduling-for-field-service)
- Microsoft, [Work order status and booking status](https://learn.microsoft.com/en-us/dynamics365/field-service/work-order-status-booking-status)
- Jobber, [Workflow overview](https://help.getjobber.com/hc/en-us/articles/360056046054-Jobber-Workflow-Overview)
- Jobber, [Request basics](https://help.getjobber.com/hc/en-us/articles/115009737048-Request-Basics)
- Jobber, [Jobs in the Jobber App](https://help.getjobber.com/hc/en-us/articles/8185260991127-Jobs-in-the-Jobber-App)
- Square, [Booking object](https://developer.squareup.com/reference/square/objects/Booking)
- Square, [Bookings API concepts](https://developer.squareup.com/docs/bookings-api/get-ready-to-use-the-api)
- Intercom, [Tickets explained](https://www.intercom.com/help/en/articles/6436600-tickets-explained)
- Zendesk, [From support requests to tickets](https://support.zendesk.com/hc/en-us/articles/4408881925786-Lesson-1-From-support-requests-to-tickets)
- HubSpot, [Lifecycle stages](https://knowledge.hubspot.com/records/use-lifecycle-stages)
- Morimoto, [Reservation vs appointment corpus study](https://www.hpu.edu/research-publications/tesol-working-papers/2020/5_morimoto_corpus.pdf) (linguistic; **medium**)

Repo: `contacts_and_requests.sql`, `appointments.sql`, `lead_status.sql`, `call_resolution.sql`, retail + home-services playbooks, `HOME_SERVICES_PHASE2.md`, `BUSINESS_INTELLIGENCE_ROADMAP.md`, constitution §9–10, Phase 4 list specs.

---

```text
RECOMMENDED SCALERS MODEL

Universal customer object:
Conversation. Already calls + transcripts. Always persisted.

Universal work object:
Customer work (conceptual). Created only when the receptionist
makes a promise or cannot finish.

Work types:
enquiry | hold | order | quote | visit | callback | other
(quote may map to enquiry until a type exists)

Work states:
open | done | cancelled
(today: request open/fulfilled/cancelled; appointment requested/confirmed/cancelled/done)

Scheduling:
Optional attribute cluster on work (when, window, place, resource/capacity).
Not a second universal object.

Conversation relationship:
Work optionally points at the source call. Call lead_status stays
owner triage of the conversation.

Appointment relationship:
Work type visit with a schedule. Display alias Appointment / Booking /
Reservation / Consultation / Job by vertical pack.

Request relationship:
Unscheduled work, or the current /requests view. Not a separate genus.

Vertical adaptation:
Playbooks, required slots, and display labels. One architecture.
Not separate products.

MVP:
Keep service_requests and appointments tables and routes.
Treat them as unscheduled vs scheduled views of one concept.
Do not persist work for answered information calls.
No Work tab. No schema merge. No CRM.

Deferred:
Physical table merge, diary/availability, OMS orders, quotes as documents,
recurring jobs, Home open-work mix, /work alias.

Current Requests route:
KEEP. Unscheduled-work view. Merge visually only in a later approved phase.
Do not deprecate the URL.

Current Appointments route:
KEEP. Scheduled-work view. May become contextual (filter) later.
Do not delete. Do not hide without a remaining path to the same rows.

Why:
The owner needs what the receptionist could not finish, not two SaaS
categories from the retail and home-services beachheads. Salesforce and
Dynamics separate what from when; Intercom refuses to ticket trivia;
Jobber treats visits as slices of a job. Scalers already has the
conversation. Work is the optional handoff. Schedule is optional on work.
```
