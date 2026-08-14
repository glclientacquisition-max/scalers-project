# Source of truth

**Status:** Governance baseline (2026-08-14)  
**Method:** Imports, route wiring, runtime call paths, and test references — not filename inference alone.

Status labels: **CORE** (production path), **LEGACY** (wired but superseded), **DUPLICATE** (parallel implementation), **DEPRECATED** (migrated away), **UNKNOWN**.

---

## Voice pipeline

| Subsystem | Source of truth | Path | Evidence | Alternatives | Status |
| --- | --- | --- | --- | --- | --- |
| Live telephony | SautiKit webhooks + PCM WS | `server.js` `/voice/incoming`, `/ws/media` | Active routes; `VOICE.md` contract | `/ws/relay` | LEGACY |
| Webhook auth | SautiKit guard | `src/sautikit/webhook.js` | `sautikitWebhookGuard` on all voice POST routes | None | CORE |
| Media transport | `audio.drachtio.org` S16LE 16 kHz | `server.js` `mediaWss` | Stream XML `connect="true"` | Twilio mu-law | DEPRECATED |

---

## STT / TTS

| Subsystem | Source of truth | Path | Evidence | Alternatives | Status |
| --- | --- | --- | --- | --- | --- |
| STT | Soniox realtime | `src/speech/sonioxStt.js` | `createSonioxSttSession` in media handler | None active | CORE |
| STT context | Per-tenant vocabulary | `src/speech/sttContext.js` | `buildSttContext` from profile | `SONIOX_STT_CONTEXT=off` | CORE |
| TTS | Soniox realtime | `src/speech/sonioxTts.js` | `createSonioxTtsSession` in media handler | None active | CORE |
| TTS normalize | Lexicon + spoken forms | `src/speech/ttsNormalize.js` | Called before every `speak` | None | CORE |
| TTS preview (desk) | Voice HTTP endpoint | `server.js` `POST /api/tts/preview` | `ttsPreview.js`; auth via `VOICE_INTERNAL_SECRET` | None | CORE |

---

## LLM / Brain

| Subsystem | Source of truth | Path | Evidence | Alternatives | Status |
| --- | --- | --- | --- | --- | --- |
| Agent runtime | Gemini turn loop | `server.js` `runGeminiTurn*` | `@google/genai` import; called from media handler | `/ws/relay` path | CORE |
| Runtime prompt assembly | Context + rules + profile | `src/prompts.js` | `buildSystemPrompt`, `buildContextHeader` | Env `BUSINESS_*` | CORE |
| Brain state | Per-call semantic memory | `src/conversation/brainState.js` | `callBrainStates` Map in `server.js` | None | CORE |
| Tool parse | Marker protocol | `src/conversation/toolMarkers.js` | `parseGeminiResponse` | None | CORE |
| Tool execute | Validated side effects | `src/conversation/toolExecution.js` | `executeBrainTools` | None | CORE |
| Brain observability | Console traces | `src/conversation/brainObservability.js` | `logBrainTrace` → stdout | None persisted | CORE (ephemeral) |

---

## Prompts

| Subsystem | Source of truth | Path | Evidence | Alternatives | Status |
| --- | --- | --- | --- | --- | --- |
| Compiled system prompt | DB column | `tenants.llm_system_prompt` | Written by desk compile actions; read by `getTenantProfile` | Local template (`onboarding.ts`) | CORE |
| Prompt compiler | Desk Gemini compile | `dashboard/src/lib/promptCompiler.ts` | `saveAndCompileSettings`, onboarding actions | `compilePromptLocally` | CORE |
| Runtime conversation rules | Code constants | `src/prompts.js` `CONVERSATION_RULES` | Injected every call | None | CORE |
| Desk prompt helpers | Compile-time only | `dashboard/src/lib/prompts.ts` | Settings/onboarding | Voice `prompts.js` | ACTIVE (split by design) |

**Gap:** No per-call prompt snapshot on `calls` — see [`../agents/PROMPT_VERSIONING.md`](../agents/PROMPT_VERSIONING.md).

---

## Pronunciation

| Subsystem | Source of truth | Path | Evidence | Alternatives | Status |
| --- | --- | --- | --- | --- | --- |
| Live TTS lexicon | Voice JS module + tenant overrides | `src/speech/pronunciationLexicon.js` + `tenants.tts_lexicon` | `prepareForTts` → `ttsNormalize` | Dashboard TS mirror | DUPLICATE |
| Desk coach / train UI | Dashboard TS module | `dashboard/src/lib/pronunciationLexicon.ts` | 10+ imports in settings/coach | Voice JS (differs) | DUPLICATE |
| Kenya base lexicon | Voice only | `KENYA_LEXICON` in `pronunciationLexicon.js` | Not in desk TS | — | CORE (voice) |
| Coach guards | Desk only | `BLOCKED_MATCH_TOKENS` in desk TS | Prevents bad train targets | — | CORE (desk) |

**Recommended future action:** Shared core module (future project — not Phase 2).

---

## Voice catalog

| Subsystem | Source of truth | Path | Evidence | Alternatives | Status |
| --- | --- | --- | --- | --- | --- |
| Curated voices (live) | DB + JSON fallback | `platform_soniox_voices` + `src/data/soniox-voices.json` | `sonioxVoiceCatalog.js`; Railway test forbids dashboard import | Dashboard mirror JSON (identical MD5) | DUPLICATE (JSON) |
| Per-tenant voice pick | DB column | `tenants.soniox_voice_id` | `resolveSonioxVoice` in `sonioxVoice.js` | Env (ignored per `.env.example`) | CORE |
| Desk admin CRUD | Dashboard TS | `dashboard/src/lib/sonioxVoiceCatalog.ts` | Admin voices API | Voice JS catalog loader | ACTIVE (split) |

---

## Business configuration

| Subsystem | Source of truth | Path | Evidence | Alternatives | Status |
| --- | --- | --- | --- | --- | --- |
| Tenant profile | Supabase `tenants` row | Columns per `schema.sql` | `getTenantProfile` progressive select | Env `TENANT_ID`, `BUSINESS_NAME` | CORE |
| Services / catalog | `tenants.services_catalog`, `product_catalog` | DB jsonb | `productCatalog.js`, desk settings | None | CORE |
| FAQs / policies / hours | `tenants` structured columns | DB | `liveKnowledge.js`, `businessHours.js` | Legacy text fields | CORE |
| Agent tools toggle | `tenants.agent_tools` | DB jsonb | `agentTools.js` | Defaults in code | CORE |
| Beachhead test fixtures | Tests only | `tests/*`, `MVP_SHIP_AND_TEST.md` | ChapterOne examples | Not in voice runtime | EXPERIMENTAL (fixtures) |

**Principle:** Platform code in `src/` and `dashboard/src/`; business facts in `tenants.*` columns.

---

## Database

| Subsystem | Source of truth | Path | Evidence | Alternatives | Status |
| --- | --- | --- | --- | --- | --- |
| Live schema | Supabase project | External | Queried by `src/db.js` | — | CORE |
| Schema documentation | Reference file | `docs/supabase/schema.sql` | Header: reference only, do not apply | — | ACTIVE (docs) |
| Schema changes | Ordered SQL scripts | `docs/supabase/*.sql` | README apply order | Supabase CLI migrations | CORE (manual) |
| Voice DB API | Stable async surface | `src/db.js` | 19 exported functions; `server.js` imports | Root `db.js` shim | CORE |
| Migration state | **UNKNOWN** on production | — | No version table in repo | — | UNKNOWN |

---

## Telephony

| Subsystem | Source of truth | Path | Evidence | Alternatives | Status |
| --- | --- | --- | --- | --- | --- |
| Inbound provider | SautiKit | External API | `server.js` webhooks; Twilio removed from path comment | Twilio `/ws/relay` | CORE / LEGACY |
| DID assignment | Pool + tenant column | `sautikit_did_pool`, `tenants.sautikit_virtual_number` | `did_number_pool.sql`, ops panels | Manual env `SAUTIKIT_DID` | CORE |

---

## Authentication

| Subsystem | Source of truth | Path | Evidence | Alternatives | Status |
| --- | --- | --- | --- | --- | --- |
| Owner sessions | Supabase Auth JWT | `dashboard/src/lib/auth.ts` | `(desk)/layout` gates | `DASHBOARD_OPEN` dev bypass | CORE |
| Super Admin | Legacy cookie | `isLegacyAuthenticated()` | `admin/layout.tsx` redirect | Supabase RBAC | LEGACY |
| Voice / signup provisioner | Service role | `SUPABASE_SERVICE_ROLE_KEY` | `supabaseClient.js`, admin APIs | — | CORE |

---

## Deployment

| Subsystem | Source of truth | Path | Evidence | Alternatives | Status |
| --- | --- | --- | --- | --- | --- |
| Voice deploy | Docker on Railway | `Dockerfile`, `railway.toml` | Health `/healthz` | `render.yaml` | CORE |
| Desk deploy | Vercel Next.js | `dashboard/vercel.json` | README: root dir `dashboard` | None | CORE |
| Voice public URL (desk → voice) | Env | `VOICE_PUBLIC_BASE_URL` | `voicePublicBase.js`, `sautikit.ts` | Hardcoded Railway default | CORE (env) |
| Referenced prod URLs | Code defaults | `scalers-project-production.up.railway.app`, `scalers-project.vercel.app` | `voicePublicBase.js`, `layout.tsx` | **UNKNOWN** if still current | UNKNOWN |

---

## Frontend

| Subsystem | Source of truth | Path | Evidence | Alternatives | Status |
| --- | --- | --- | --- | --- | --- |
| Owner UI | Next.js App Router desk shell | `dashboard/src/app/(desk)/` | Build output routes | None | CORE |
| Admin UI | Next.js admin shell | `dashboard/src/app/admin/` | Legacy auth gate | None | CORE |
| Marketing | Landing | `dashboard/src/app/page.tsx` | Root route | None | CORE |

---

## Notifications

| Subsystem | Source of truth | Path | Evidence | Alternatives | Status |
| --- | --- | --- | --- | --- | --- |
| Channel dispatch | Priority chain | `src/notifications/dispatch.js` | TextSMS → WhatsApp → email | Direct module calls | CORE |
| SMS | TextSMS.co.ke | `src/notifications/sms.js` | Private-beta primary | — | CORE |
| WhatsApp | SautiKit | `src/notifications/whatsapp.js` | Secondary channel | Twilio (historical) | CORE |
| Email | Resend | `src/notifications/email.js` | Fallback | — | CORE |

---

## Related documents

- [`REPOSITORY_INVENTORY.md`](./REPOSITORY_INVENTORY.md)
- [`../architecture/CURRENT_STATE.md`](../architecture/CURRENT_STATE.md)
- [`../agents/AGENT_ARCHITECTURE.md`](../agents/AGENT_ARCHITECTURE.md)
