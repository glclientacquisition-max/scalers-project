---
owner: brain
last_reviewed: 2026-10-22
status: planned
---

> **Status: planned, not built (Alvin, 22 Oct 2026).** No code, SQL or flag exists for this yet; nothing here is approved for build. Names, places and receipt ids in examples are made up.
>
> Reference copy of the box brief `briefs/caller-profile-research-2026-10-22.md`. Paths under `/workspace/` are box paths and are not in the repo. See [STATUS.md](../../STATUS.md).

# Caller Profile v2 ("caller history v2") — research brief
**Date:** 22 Oct 2026 (EAT) · **Author:** Chief of OSS (research only, no code) · **Requested by:** Alvin via Scalers Chief · **ICP:** cleaning / home services
**Status:** compact brief (usage-constrained). Vendor coverage deliberately short; design + DPA sections prioritised. Sources verified by HTTP fetch on 22 Oct 2026 unless marked.

---

## 1. Executive summary
- **Nobody in the market does what we need out of the box.** Voice platforms (Retell, Vapi) inject a per-caller blob/variables at call start keyed on **phone number**; frameworks (LiveKit, Pipecat) give you a typed per-session object and leave persistence to you; memory layers (Mem0, Zep, Letta) store LLM-extracted free-text facts. None ships a **bind gate**, **shared-line handling**, or **confirmed-receipt-only writes** — those are ours to build.
- **Retell's "contact memory" is the closest analogue and a warning:** one 2,000-char free-text brief per phone number, LLM-rewritten after every call from the transcript ([Retell contact memory](https://docs.retellai.com/features/contact-memory)). Fast and simple, but transcript-derived (not receipt-derived), unscoped by person, and leaks history to anyone holding the phone.
- **Borrow ideas, build the store.** Mirror #854's typed-fact pattern in Supabase: typed rows with `source`, `confidence`, `valid_from/valid_to` (Zep/Graphiti-style bi-temporal), `expires_at` (Mem0-style). Read = thin **safe card** before turn 1 + **gated Gemini tool** `get_caller_history` after bind. Write = **one post-call writer** consuming confirmed receipts, idempotent on `(call_id, receipt_id)`.
- **DPA 2019 drives the shape:** s.29 notice at call open, s.25 minimisation (no free-text transcript dumps in the profile), s.39 + Reg 19 retention schedule, s.26/s.40 access/correct/erase with a 14-day erasure SLA (Reg 12(3)).

## 2. Recommended design for Scalers (cleaning / home services)

### 2.1 Identity model (multiple people on one phone)
- `phone_line` (E.164, tenant-scoped) ≠ `person`. A line links to 0..n persons via `line_person(line_id, person_id, role, confirmed_at)`.
- ANI = **candidate** identity only. `bind_state ∈ {unbound, candidate, bound}`; bound only after name confirmed (existing `nameConfirmed`) **and**, for a multi-person line, the caller picks/states which person.
- `line.shared = true` when >1 confirmed person, or owner flags it (office line, house-help phone, estate caretaker) → **ask-always**, never greet by name.
- Property is a first-class entity, because in cleaning the *place* recurs more than the *person*: `property(id, label, estate/area, landmark_directions, access_notes, size_hint)` linked to persons via `person_property(role: owner|tenant|househelp|manager)`. A property/estate manager can book for many properties.

### 2.2 Typed fields (caller_profile_v2)
| Table / field | Type | Notes |
|---|---|---|
| `person`: display_name, preferred_language (en/sw/sheng-mix), preferred_contact_channel (call/SMS/WhatsApp) | typed | name only from confirmed receipt |
| `preference` rows: key ∈ {preferred_cleaner, preferred_day, preferred_time_window, service_type_default, products_note, pets, do_not_contact_window} | typed enum key + typed value | each row carries provenance (below); no free-text "notes about customer" |
| `open_item` rows: kind ∈ {quote_pending, booking_unconfirmed, callback_promised, complaint_open, reschedule_request}, property_id, due_at, status | typed | sourced from existing open requests |
| `visit` rows (existing): property_id, service, scheduled_for, cleaner_id, status, outcome | typed | already in DB; profile reads, does not copy |
| `last_outcome`: derived view = latest call receipt {intent, result ∈ booked/quoted/callback/no_action/escalated, at} | derived | never stored twice |
| `consent`: recording_consent, profile_consent, marketing_consent, notice_version, captured_at, channel | typed | DPA s.29/s.30 evidence |

No embeddings/vector memory for v2: the facts are few, enumerable, and must be auditable. Embedding search (Mem0/Letta archival) solves a problem we don't have and makes s.26 access / s.40 erasure harder to prove.

### 2.3 Provenance, confidence, decay (every fact row)
`source ∈ {owner_desk, confirmed_receipt, booking_system, caller_stated_unconfirmed}`, `source_ref` (call_id/receipt_id/user_id), `confidence ∈ {verified, confirmed, stated}`, `valid_from`, `valid_to` (null = current), `expires_at`, `superseded_by`.
- **Precedence:** owner_desk > booking_system > confirmed_receipt > caller_stated. Caller correction in-call wins *for that call* (as Retell's default prompt does) but is persisted only via a receipt.
- **Never delete on contradiction — close it:** set `valid_to=now`, `superseded_by=new_id` (Graphiti bi-temporal pattern: [Zep facts](https://help.getzep.com/facts.mdx)). Hard delete only for DPA erasure.
- **Decay defaults (proposal, tune with data):** preferred_cleaner 180 d since last confirming visit; time-window/day prefs 365 d; open_item auto-closes at `due_at + 30 d` → status `stale`, shown to owner, never spoken; `stated` rows expire 30 d unless confirmed. Expired rows are hidden from reads (Mem0 semantics: [expiration](https://docs.mem0.ai/platform/features/memory-expiration)) and purged by the retention job.

### 2.4 Read strategy
1. **Pre-turn-1 prefetch (keyed on ANI + tenant):** one indexed query returns a **safe card** — `{bind_state: candidate, line_shared, known_person_count, has_open_items: bool, preferred_language}`. No names, addresses, or history until bound. Cache in session state (LiveKit `userdata`/Pipecat-style per-session object).
2. **Bind:** confirm name (and person on shared lines). On bind, inject a **bound card** ≤ ~150 tokens: first name, default property label + area, preferred cleaner, top 1–2 open items, last outcome.
3. **Gated Gemini native tool** `get_caller_history(scope: open_items|visits|preferences|property, property_id?)` — schema-registered from start but the handler refuses (`{error:"not_bound"}`) unless `bind_state=bound`. Filler "Let me check" (≤3 words) while in flight. This is the Intercom Fin data-connector / Retell-function pattern, with our gate added.
4. Never put the full history in the prompt; token budget stays flat as tenants accumulate visits.

### 2.5 Write rules
- **Single writer:** a post-call `ProfileWriter` job (not the live Brain) consumes the call's **confirmed receipts** (booking created, quote sent, callback logged, name confirmed, preference read-back accepted). Mid-call model guesses never write.
- **Idempotency:** unique key `(tenant_id, call_id, receipt_id, fact_key)`; replays are no-ops. Use the provider's call id for dedupe as Retell recommends for webhook retries ([Retell inbound webhook](https://docs.retellai.com/features/inbound-call-webhook)).
- Preferences are written only if the agent **read back and the caller said yes** (receipt type `pref_confirmed`); otherwise row saved as `stated` with 30-d expiry and surfaced to owner Desk for approval (fits approve-first workflow).
- Owner Desk edits write directly with `source=owner_desk` and win.
- Failed/empty write leaves prior state unchanged (same as Retell's behaviour).

### 2.6 Latency plan
- Vendors give hard ceilings, not profile-load numbers: Vapi's `assistant-request` must answer within **7.5 s** end-to-end and recommends returning a minimal assistant then enriching later ([Vapi server events](https://docs.vapi.ai/server-url/events.mdx)); Retell's inbound webhook default timeout is 10 s with 2 retries ([Retell](https://docs.retellai.com/features/inbound-call-webhook)). **No vendor publishes typical memory-load latency** — we must measure our own.
- Plan: safe-card query on a single covering index `(tenant_id, phone_e164)` in Supabase, fired at SautiKit ring/answer event in parallel with greeting TTS; **budget target ≤150 ms p95 (our proposal, unmeasured)**; on timeout greet generically and treat as `unbound` (fail-closed). Bound card fetched during name confirmation turn, so it's warm by bind. Tool lookups after bind are covered by filler.

### 2.7 Privacy & retention — Kenya Data Protection Act 2019
| Requirement (source) | What it means for caller profile v2 |
|---|---|
| **s.29 Duty to notify** — before collecting, inform subject of rights, purpose, third parties, controller contacts, security ([Act](https://new.kenyalaw.org/akn/ke/act/2019/24/eng%402022-12-31)) | Short spoken notice at call open (recording + "we keep your booking details to serve you") + link via SMS/WhatsApp to full notice; store `notice_version` in `consent`. |
| **s.25 principles** — purpose limitation, adequate/relevant/limited to what is necessary, accurate, kept identifiable no longer than necessary, no transfer outside Kenya without safeguards/consent ([ODPC](https://www.odpc.go.ke/rights-of-a-data-subject/)) | Typed fields only, no free-text dossiers or raw transcripts in profile; accuracy via precedence + supersede; note Gemini/Soniox processing is cross-border → needs documented safeguards/consent (flag for counsel). |
| **s.26 rights** — informed, access, object, correct, delete false/misleading ([Act](https://new.kenyalaw.org/akn/ke/act/2019/24/eng%402022-12-31)) | Desk "export this person" (all rows incl. provenance) and "correct" actions; caller can object → `profile_consent=false` disables reads/writes for that person. |
| **s.39 retention limit** + **Reg 19** retention schedule with purpose, period, periodic audit ([Regulations 2021](https://www.odpc.go.ke/wp-content/uploads/2024/03/THE-DATA-PROTECTION-GENERAL-REGULATIONS-2021-1.pdf)) | Publish schedule (proposal): profile facts 24 months after last interaction; call audio 90 days unless consented for quality corpus; receipts kept as business records per tenant's legal needs; nightly purge/anonymise job + quarterly audit log. |
| **s.40 rectification & erasure**; Reg 12: erasure request answered **within 14 days**, free of charge; s.40(3) restrict instead of erase when needed as evidence | Erasure = hard delete person + person-scoped rows, detach from line/property, propagate to processors (s.40(2)); keep anonymised visit counts for tenant billing. Track SLA in Desk. |
| Controller vs processor | Tenant (cleaning business) is controller of its customers' data; Scalers is processor → DPA/contract needed; ODPC registration status of Scalers and tenants **not verified here — flag for counsel**. |

## 3. Vendor / tool comparison (short)
| Tool | Data model | Read path | Bind gate? | Provenance / decay | Writes | Status |
|---|---|---|---|---|---|---|
| **Retell AI** | Contact (by phone) with typed custom fields + one free-text memory ≤2,000 chars ([contacts](https://docs.retellai.com/features/contacts), [memory](https://docs.retellai.com/features/contact-memory)) | Fields as dynamic variables + memory auto-injected; inbound webhook can add vars pre-connect ([webhook](https://docs.retellai.com/features/inbound-call-webhook), [dynamic vars](https://docs.retellai.com/build/dynamic-variables)) | No — matched by phone number | None published; resolved items dropped on rewrite | LLM rewrites memory after each call from transcript | Live, actively documented |
| **Vapi** | Whatever your server returns | `assistant-request` webhook → variableValues / transient assistant, ≤7.5 s ([events](https://docs.vapi.ai/server-url/events.mdx), [personalization](https://docs.vapi.ai/assistants/personalization.mdx)); tools via server URL ([server URLs](https://docs.vapi.ai/server-url/setting-server-urls.mdx)) | DIY | DIY | DIY (end-of-call events) | Live |
| **LiveKit Agents** | Typed per-session `userdata` (dataclass / TS interface) ([handoffs](https://docs.livekit.io/agents/logic/agents-handoffs/), [sessions](https://docs.livekit.io/agents/logic/sessions/)); participant attributes are visible to all participants — not for sensitive data ([attributes](https://docs.livekit.io/transport/data/state/participant-attributes/)) | Function tools read/write `RunContext.userdata` | DIY (natural fit: tool returns gated by userdata flag) | None | DIY persistence | Live, OSS |
| **Pipecat** | No native store; `Mem0MemoryService` adds Mem0 ([docs](https://docs.pipecat.ai/api-reference/server/services/memory/mem0), [ref](https://reference-server.pipecat.ai/en/stable/api/pipecat.services.mem0.memory.html)) | Searches memories on each user message and injects them as system/developer msg; `get_memories()` for greeting | No | via Mem0 | Stores every message in Mem0 | Live, OSS |
| **Intercom Fin** | People/Company typed attributes; Data Hub (open beta) with per-attribute Fin access toggle + audience; source & last-updated metadata "coming soon" ([Data Hub](https://www.intercom.com/help/en/articles/16340024-using-the-data-hub-to-personalize-fin-s-responses)) | Enabled attributes in context; data connectors = live API calls Fin chooses ([connectors](https://www.intercom.com/help/en/articles/9916497-how-to-set-up-data-connectors), [procedures](https://www.intercom.com/help/en/articles/13459820-how-to-use-data-connectors-in-fin-procedures)) | Identity comes from logged-in messenger, not voice | Planned, not shipped | Attributes set by Fin/workflows ([attributes](https://www.intercom.com/help/en/articles/10546434-how-attributes-can-power-your-fin-tasks-workflows-and-data-connectors)) | Live (Data Hub beta) |
| **Zendesk AI agents** | Session params/metadata per conversation ([dev docs](https://developer.zendesk.com/documentation/ai-agents/getting-started/session/), [params](https://support.zendesk.com/hc/en-us/articles/9522180655386-Using-parameters-in-AI-agents)) | Session-scoped; Zendesk help says agents don't remember across conversations by default ([FAQ](https://support.zendesk.com/hc/en-us/articles/11231572134938-Can-we-enable-AI-agents-to-remember-previous-replies-conversations-feedback-etc)) | n/a | n/a | n/a | Live |
| **Sierra** | "Agent Data Platform" — cross-session memory combining conversations with business systems ([blog](https://sierra.ai/blog/agent-data-platform), [Agent OS 2.0](https://sierra.ai/blog/agent-os-2-0)) | Not publicly documented | Not published | Not published | Not published | Live, closed; **marketing-level source only** |
| **Mem0** | LLM-extracted text memories scoped by user/agent/run id + metadata; v3 add is ADD-only, async ([add API](https://docs.mem0.ai/api-reference/memory/add-memories)) | Semantic search | No | `expiration_date` hides (not deletes) ([expiry](https://docs.mem0.ai/platform/features/memory-expiration)) | `add()` from messages; `infer=false` for verbatim ([add](https://docs.mem0.ai/core-concepts/memory-operations/add)) | Live, OSS + cloud |
| **Zep / Graphiti** | Temporal knowledge graph; facts are edges with valid/invalid timestamps ([facts](https://help.getzep.com/facts.mdx), [Graphiti](https://github.com/getzep/graphiti)) | Graph/semantic search | No | **Best-in-class**: contradiction invalidates old fact, keeps history | Ingest episodes, LLM extracts | Live, OSS (Graphiti) + cloud |
| **Letta (MemGPT)** | Core memory blocks (label/description/value/char-limit) pinned in prompt; archival = searchable store ([blocks](https://docs.letta.com/v1-sdk/memory/memory-blocks/index.md), [archival](https://docs.letta.com/v1-sdk/memory/archival-memory/index.md)) | Blocks always in context; archival via tool | No | None | Agent edits its own memory via tools mid-conversation | Live, OSS |

## 4. Borrow vs build verdicts
- **Retell** — borrow: "caller correction wins", "failed update leaves prior state", contact-fields-vs-memory split. Reject: phone-keyed, transcript-rewritten free-text memory.
- **Vapi** — borrow: "return minimal fast, enrich after start" latency rule. Nothing to adopt.
- **LiveKit** — borrow: typed per-session state object + tools that mutate it (we already use AgentTask ideas). Don't use participant attributes for profile data.
- **Pipecat + Mem0 service** — reject for v2: per-message semantic injection = uncontrolled tokens, no gate.
- **Intercom Fin** — borrow: per-attribute "model access" toggle (enabled/test/disabled) and audience scoping → add `agent_readable` + `speakable_before_bind` flags to each field definition.
- **Zendesk** — nothing (session-only).
- **Sierra** — validates the direction (memory + business data); no implementable detail published.
- **Mem0** — borrow: `expires_at` hide-then-purge semantics. Don't adopt the service (LLM-inferred writes, cross-border, harder erasure proof).
- **Zep/Graphiti** — borrow: bi-temporal supersede instead of overwrite. Don't run a graph DB; Postgres columns suffice.
- **Letta** — borrow: char-limited labelled blocks for the bound card (hard size cap). Reject: agent self-editing memory mid-call (violates single-writer).

## 5. Mirror from #854 vs what's different
*(#854 not read in this pass — based on Scalers Chief's description "typed shop fact store".)*
- **Mirror:** typed key registry (enum keys with value schema), provenance columns, owner-Desk edit as top-precedence source, tool-based read via Gemini native tools (#855), same supersede/versioning mechanics so one library serves both.
- **Different:** shop facts are business-owned, public-ish, non-personal, long-lived; caller facts are **personal data** → need bind gate, per-person consent flags, decay/expiry, retention purge, access/export and erasure paths, shared-line logic, and are written only from call receipts by the post-call writer (shop facts are written mainly by owners/KB crawl).

## 6. Gaps / unknowns
- No vendor publishes memory-load latency; our 150 ms target is a proposal to measure.
- Sierra: only blog-level sources. Zendesk: help-centre FAQ, not API guarantees.
- Intercom provenance/last-updated metadata is "coming soon", not shipped.
- DPA: data-access-request response time under the Regulations and Scalers'/tenants' ODPC registration status not verified here; cross-border transfer basis for Gemini/Soniox needs legal review (ss.48–50 not read in this pass).
- #854 / callerMemory.js not re-read in this pass.

## 7. Sources (fetched 22 Oct 2026)
See inline links; verification results appended below.

**Verification (22 Oct 2026, ~09:45 EAT):** all inline links returned HTTP 200 via curl except:
- `new.kenyalaw.org` DPA page — curl 403 (bot block); page loads via WebFetch and section text (ss.26, 29, 39, 40) was read from it. Backup official copy: https://kenyalaw.org/kl/fileadmin/pdfdownloads/Acts/2019/TheDataProtectionAct__No24of2019.pdf (Kenya Gazette Supplement No. 181, Act No. 24 of 2019).
- `odpc.go.ke/rights-of-a-data-subject/` — curl timed out; loads via WebFetch (rights + s.25 principles text confirmed).
- Regulations PDF (Legal Notice 263 of 2021) — 200; Reg 12(3) 14-day erasure and Reg 19 retention schedule read from it.
- Sierra links load but are marketing blogs, not technical docs.
