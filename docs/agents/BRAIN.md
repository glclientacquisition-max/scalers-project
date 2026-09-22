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

**First-open introduction:** Brand-first English greeting via `src/conversation/businessAssistantIntro.js`: one steady person (`Hello, this is {agent} at {business}. You can speak in English or Kiswahili. How can I help you?`). Do not list services on the opener, open or closed. Closed adds honesty then still help. Offering stays in live ground truth for later turns. Do not lottery-open in Kiswahili. After the caller speaks, match and stay in their language.

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
  → structured Brain state (goal / intent / entities / language / repair), seeded from a returning-caller card when the phone is known
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
3. Auto language match: en / sw / sheng; switch when the caller switches. Owner tone is manner only (`professional` or `warm`). It does not turn Sheng on or off. Angry-caller mood (drop cheerful filler) applies for every tone. Older chips `friendly` / `empathetic` / `localized` compile as `warm`. Owner business type is Shop (stored `retail`) or Home services. `shop` parses as `retail`. Hospitality and general stay stored ids; they get no hold or visit playbook and no force-save until a reservation pack exists. Do not sell Hotel or Other on onboarding.
4. Lead capture: name + reason only when required for a saved request or justified handoff; confirm unclear names. STT variants auto-match to a returning-caller file name or a Kenya given-name table (`src/conversation/callerNameMatch.js`) so the spoken/saved spelling is canonical (Isha → Aisha). Collision pairs (Colin/Collins) are not silent-rewritten: ask once, or keep the returning-file spelling. Do not invent names. Do not write free-form caller names into the TTS lexicon.
5. After-hours / bulletin: honesty first, then still help per `after_hours_mode` (serve vs message). Promo bulletins must not be volunteered off-topic.
6. Holds and orders require catalogue-grounded titles (plus required slots); unlisted or garbled titles → enquiry / special-order quote, not a clean hold/order. Refining pickup time updates the same hold.
7. Missing catalogue prices and empty policy fields are unknown — never invent amounts or policy wording; do not force name capture.
8. Catalogue: base prompt keeps a short overview; each turn injects **TARGETED PRODUCT MATCHES** from the full catalogue (not only the first 100 rows). Genre/category asks must not recommend Sample titles from another category — empty TARGETED for that genre → admit none listed.
9. Escalation requires caller name + reason; notify WA/email when configured; if channels are down, persist a desk note and soft-confirm follow-up (never invent a live transfer). When NEXT BEST ACTION is ESCALATE and name is known, the escalate tool must fire (backend may inject if the model only shares a phone/WhatsApp). When NEXT BEST ACTION is CREATE_REQUEST and slots are complete, `create_appointment` / `create_service_request` / `update_appointment` must fire (backend may inject if the model only speaks). Spoken confirmation comes from the tool result after the row insert, never from the model promising booked or held. Live Dial is specified in [`../LIVE_TRANSFER.md`](../LIVE_TRANSFER.md); until Voice sets `liveTransfer: true`, NBA stays ESCALATE even if `handoff_mode` is `live_transfer`.
10. Call summary / primary intent persist instantly from Brain state + tools (STT text). Gemini does **not** hear live audio. Hangup `primary_intent` is a high-water mark from saved tools (visit, hold, escalate) so a last-turn FAQ cannot stamp Answered over saved work. Live turn intent still follows the latest ask so hours after a booking can be answered. After hangup, a fire-and-forget hangup job (`src/conversation/callTranscriptReview.js`) upserts a `contacts` row (name may stay null) and runs a **narrow name extract** (name or `NONE`) plus the **transcript review** (Flash-Lite, ~8s timeout) that writes `owner_review` `{want, done, mood, next, reason}`. `reason` stays the Inbox one-liner. `want` is the call Summary Want block and `contacts.last_reason`. Merge still only upgrades `needs_human` when rules agree and does not undo a saved hold, visit, or escalate. Kill switch for review only: `POST_CALL_GEMINI_REVIEW=off`. Contact persist still runs. Ignore STT fragments/backchannels as caller name or goal text; prefer `human` when handoff was requested. Do not send the four-block card on owner SMS until proven.
11. Compiled `llm_system_prompt` is written by Desk compiler; owners do not edit raw prompt in UI. Stale compiled prompts that force name capture fight resolution-first runtime — recompile after Brain policy changes.
12. Tool side-effects go through existing DB helpers (`saveCallerInfo`, `saveEscalation`, …). Call outcomes persist via `deriveCallResolution` / `setCallResolution`.
13. Returning callers: load a compact phone file at call setup (`getCallerMemory` → CONTEXT HEADER). After a confirmed spoken name, bind that same phone card to the speaker (shared line: primary keeps the visit; alternate does not). The file may include last reason, the next visit, and up to two recent bookings. Never dump prior transcripts. Instant greeting stays brand-first and local.

## Test / verify

- **MVP ship gate:** `npm run test:mvp` (Brain + knowledge + retail/escalation/MVP smokes). Live DID pack: `docs/MVP_SHIP_AND_TEST.md`
- Escalation smoke: `npm run smoke:escalation` (or `node scripts/smoke-escalation-scenarios.js`)
- Brain outcomes: `npm run test:brain`
- Returning-caller evals: `npm run eval:brain`
- Manual: change settings → compile → place a test call; confirm CONTEXT HEADER / ground truth behavior
- Do not require `npm run test:voice` unless you touched media path (you shouldn’t)

## Related

Caller-experience excellence vs live gaps: [`CALLER_EXPERIENCE_EXCELLENCE.md`](./CALLER_EXPERIENCE_EXCELLENCE.md).

## Chat starter

```
You are the Scalers Brain lane agent.
Follow docs/agents/BRAIN.md, CONTEXT.md, and .cursor/rules/brain.mdc.
Own prompts, conversation logic, tools, and prompt compilation.
Do not change speech/media plumbing, wallet/DID ops, or visual redesigns.
Preserve short spoken replies, no invented facts, en/sw/sheng auto-match.
Task: <one concrete brain / knowledge / prompt improvement>
```

## Good first tickets

- Home services **live** DID pack: [`../HOME_SERVICES_MVP_BAR.md`](../HOME_SERVICES_MVP_BAR.md) (cleaning beachhead). Repo spine is not the GO.
- Stronger “I don’t know” + unknown_answer_fallback behavior
- Better name confirmation / correction loop
- Bulletin + closed-mode reply quality
- FAQ extraction quality from transcripts
- Split Gemini tool parsing out of `server.js` into `src/conversation/`
- One CX factor from [`CALLER_EXPERIENCE_EXCELLENCE.md`](./CALLER_EXPERIENCE_EXCELLENCE.md) (one character, one PR)
