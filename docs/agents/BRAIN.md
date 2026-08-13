# Brain lane contract

**Mission:** Make the receptionist smart, conclusive, and grounded — English / Kiswahili / Sheng — without inventing facts.

Use for prompts, conversation policy, tools, live knowledge, hours/bulletin logic, escalation copy, and desk prompt compilation.

## Owns (edit freely)

| Path | Role |
| --- | --- |
| `src/prompts.js` | System prompt, context header, greeting builders |
| `src/conversation/**` | Hours, bulletin, live knowledge, language, escalation, agent tools, dynamic speech |
| `dashboard/src/lib/promptCompiler.ts` | Settings → `llm_system_prompt` compile |
| `dashboard/src/lib/prompts.ts` | Desk-side prompt helpers |
| `dashboard/src/lib/gemini.ts` | Desk Gemini compile client |
| `dashboard/src/lib/faqs.ts`, `faqFromTranscript.ts` | FAQ knowledge helpers |
| `dashboard/src/lib/hoursSchedule.ts`, `afterHours.ts`, `dailyBulletin.ts`, `servicesCatalog.ts`, `agentTools.ts` | Structured knowledge models |
| `dashboard/src/lib/ingest/**` | Knowledge ingest extract/sanitize |
| `dashboard/src/app/(desk)/settings/actions.ts` | `saveAndCompileSettings` and related |
| `dashboard/src/app/(desk)/settings/ingestActions.ts`, `bulletinActions.ts` | Knowledge / bulletin server actions |
| `dashboard/src/app/(desk)/calls/faqActions.ts` | FAQ suggestions from calls |
| `dashboard/src/app/onboarding/actions.ts` | Onboarding compile into prompt |
| `scripts/smoke-escalation-scenarios.js` | Escalation scenario smoke |

Also OK: tiny Gemini tool-parse helpers inside `server.js` **only** when Brain tools change (`save_caller_info`, escalate, end_call). Prefer extracting to `src/conversation/` over growing the monolith.

**MVP product job:** Onboard a business → the DID answers unanswered calls efficiently (greet, hours/location/FAQ, message/hold/escalate, notify). Full-assist resolution remains the north star (`docs/BUSINESS_INTELLIGENCE_ROADMAP.md`) but does not block MVP. Gate: `docs/MVP_SHIP_AND_TEST.md` + `npm run test:mvp`.

**First-open introduction:** Brand-first English greeting via `src/conversation/businessAssistantIntro.js` (business name → agent name → short grounded offering → English/Kiswahili invite → help invite). Offering comes only from services on file. Do not lottery-open in Kiswahili; match language after the caller speaks.

## Do not touch

- `src/speech/**`, media PCM / barge-in / Soniox wiring (Voice)
- Desk layout, marketing hero, visual design polish (Desk UI/UX) — Brain may change settings *copy/fields* for knowledge, not restyle the shell
- Wallet rates, DID pool, Super Admin ops (Ops)
- New Supabase columns/RPCs without Platform

## Architecture snapshot

```
Desk structured fields (hours, services, FAQs, team, bulletin, tone)
  → Gemini prompt compiler → tenants.llm_system_prompt
Voice loads tenant profile per call
  → structured Brain state (goal / intent / entities / language / repair)
  → authority policy + next-best-action
  → buildSystemPrompt + CONTEXT HEADER + LIVE GROUND TRUTH + CALL STATE
  → Gemini response plan → validated tool request
  → backend result → caller confirmation
```

Core runtime modules:

- `src/conversation/brainState.js` — call-local semantic memory
- `src/conversation/entityExtraction.js`, `goalModel.js` — grounded slots and completion
- `src/conversation/brainPolicy.js`, `nextBestAction.js` — authority + resolution ladder
- `src/conversation/conversationRepair.js` — bounded contextual repair
- `src/conversation/toolExecution.js` — validated actions and confirmed results
- `src/conversation/brainObservability.js` — PII-safe structured decision traces

## Invariants

1. Spoken replies stay short (≈ ≤25 words, phone-friendly).
2. Never invent prices, availability, or guarantees — use live ground truth / unknown fallback.
3. Auto language match: en / sw / sheng; switch when the caller switches.
4. Lead capture: name + reason only when required for a saved request or justified handoff; confirm unclear names.
5. After-hours / bulletin: honesty first, then still help per `after_hours_mode` (serve vs message). Promo bulletins must not be volunteered off-topic.
6. Holds and orders require catalogue-grounded titles (plus required slots); unlisted or garbled titles → enquiry / special-order quote, not a clean hold/order. Refining pickup time updates the same hold.
7. Missing catalogue prices and empty policy fields are unknown — never invent amounts or policy wording; do not force name capture.
8. Catalogue: base prompt keeps a short overview; each turn injects **TARGETED PRODUCT MATCHES** from the full catalogue (not only the first 100 rows). Genre/category asks must not recommend Sample titles from another category — empty TARGETED for that genre → admit none listed.
9. Escalation requires caller name + reason; notify WA/email when configured; if channels are down, persist a desk note and soft-confirm follow-up (never invent a live transfer). When NEXT BEST ACTION is ESCALATE and name is known, the escalate tool must fire (backend may inject if the model only shares a phone/WhatsApp).
10. Call summary / primary intent are derived from Brain state + tools (STT text) — Gemini does **not** need to hear live audio. Ignore STT fragments/backchannels as caller name or goal text; prefer `human` when handoff was requested.
11. Compiled `llm_system_prompt` is written by Desk compiler; owners do not edit raw prompt in UI. Stale compiled prompts that force name capture fight resolution-first runtime — recompile after Brain policy changes.
12. Tool side-effects go through existing DB helpers (`saveCallerInfo`, `saveEscalation`, …). Call outcomes persist via `deriveCallResolution` / `setCallResolution`.

## Test / verify

- **MVP ship gate:** `npm run test:mvp` (Brain + knowledge + retail/escalation/MVP smokes). Live DID pack: `docs/MVP_SHIP_AND_TEST.md`
- Escalation smoke: `npm run smoke:escalation` (or `node scripts/smoke-escalation-scenarios.js`)
- Brain outcomes: `npm run test:brain`
- Manual: change settings → compile → place a test call; confirm CONTEXT HEADER / ground truth behavior
- Do not require `npm run test:voice` unless you touched media path (you shouldn’t)

## Chat starter

```
You are the Scalers Brain lane agent.
Follow docs/agents/BRAIN.md and .cursor/rules/brain.mdc.
Own prompts, conversation logic, tools, and prompt compilation.
Do not change speech/media plumbing, wallet/DID ops, or visual redesigns.
Preserve short spoken replies, no invented facts, en/sw/sheng auto-match.
Task: <one concrete brain / knowledge / prompt improvement>
```

## Good first tickets

- Stronger “I don’t know” + unknown_answer_fallback behavior
- Better name confirmation / correction loop
- Bulletin + closed-mode reply quality
- FAQ extraction quality from transcripts
- Split Gemini tool parsing out of `server.js` into `src/conversation/`
