# Repository inventory

**Status:** Governance baseline (2026-08-14)  
**Scope:** Important directories and entry points only — not every file.

Classification: **CORE** · **ACTIVE** · **LEGACY** · **EXPERIMENTAL** · **DUPLICATE** · **DEPRECATED** · **UNKNOWN**

---

## Root / voice engine

| Path | Purpose | Status | Notes |
| --- | --- | --- | --- |
| `server.js` | Voice HTTP + WS + turn loop | CORE | 2,841 LOC monolith |
| `db.js` | Compatibility shim | ACTIVE | Re-exports `src/db.js` |
| `src/db.js` | Voice DB API | CORE | Stable contract for all lanes |
| `src/lib/supabaseClient.js` | Service-role client | CORE | Server-only |
| `src/prompts.js` | Runtime prompt assembly | CORE | Brain lane touches policy |
| `src/speech/` | Soniox STT/TTS, turn-taking, normalize | CORE | Voice lane |
| `src/conversation/` | Brain runtime, tools, catalog | CORE | Brain + Voice integration |
| `src/notifications/` | Alert dispatch | CORE | Ops + Voice |
| `src/sautikit/webhook.js` | Webhook signature guard | ACTIVE | Partial telephony extraction |
| `src/data/soniox-voices.json` | Voice catalog JSON fallback | CORE | Duplicated in dashboard |
| `tests/` | Automated tests | ACTIVE | 35 files |
| `scripts/` | Smoke, tunnel, harness | ACTIVE | Manual QA |
| `Dockerfile` | Voice container | CORE | Node 22 |
| `railway.toml` | Railway deploy | CORE | |
| `render.yaml` | Render alt deploy | ACTIVE | |
| `.env.example` | Voice env template | ACTIVE | |

---

## Dashboard

| Path | Purpose | Status | Notes |
| --- | --- | --- | --- |
| `dashboard/src/app/(desk)/` | Owner desk routes | CORE | Calls, settings, wallet |
| `dashboard/src/app/admin/` | Super Admin | CORE | Legacy cookie auth |
| `dashboard/src/app/api/` | Server API routes | CORE | Auth, admin, preview |
| `dashboard/src/lib/promptCompiler.ts` | Prompt compile | CORE | Brain lane |
| `dashboard/src/lib/pronunciationLexicon.ts` | Pronunciation coach | DUPLICATE | Mirrors voice JS (differs) |
| `dashboard/src/lib/businessAssistantIntro.ts` | Greeting preview | DUPLICATE | Mirrors voice JS (differs) |
| `dashboard/src/lib/sonioxVoiceCatalog.ts` | Voice picker + admin | DUPLICATE | JSON identical; logic parallel |
| `dashboard/src/components/TenantForm.tsx` | Settings UI | CORE | 2,181 LOC monolith |
| `dashboard/src/components/PronunciationCoach.tsx` | Train pronunciation | ACTIVE | 1,455 LOC |
| `dashboard/vercel.json` | Vercel config | CORE | |
| `dashboard/.env.example` | Desk env template | ACTIVE | |

---

## Documentation

| Path | Purpose | Status | Notes |
| --- | --- | --- | --- |
| `AGENTS.md` | Five-lane governance | CORE | Extended in Phase 2 |
| `docs/agents/*.md` | Lane contracts | CORE | VOICE, BRAIN, DESK_UX, OPS, PLATFORM |
| `docs/architecture/` | Current-state architecture | ACTIVE | Phase 2 |
| `docs/governance/` | Governance baseline | ACTIVE | Phase 2 |
| `docs/database/` | DB governance | ACTIVE | Phase 2 |
| `docs/operations/` | Deploy + env | ACTIVE | Phase 2 |
| `docs/adr/` | Architecture decisions | ACTIVE | Phase 2 |
| `docs/supabase/` | SQL scripts + apply order | CORE | 31 scripts |
| `docs/ARCHITECTURE_MIGRATION_BLUEPRINT.md` | Migration history + target | ACTIVE | Updated: historical vs current |
| `docs/TARGET_MODULE_LAYOUT.md` | Target module tree | ACTIVE | Future layout |
| `docs/MVP_SHIP_AND_TEST.md` | MVP gate | CORE | Product |
| `docs/ONE_WALLET_BILLING.md` | Billing spec | CORE | Ops |

---

## Cursor / agent tooling

| Path | Purpose | Status |
| --- | --- | --- |
| `.cursor/rules/*.mdc` | Lane + design mandate rules | CORE |

---

## Legacy / deprecated (do not delete — classify only)

| Path | Purpose | Status | Evidence |
| --- | --- | --- | --- |
| `server.js` `/ws/relay` handler | ConversationRelay text WS | LEGACY | Comment + `VOICE.md` |
| `docs/supabase/escalation_enabled.sql` | Telegram-era toggle | DEPRECATED | README: do not apply |
| `dashboard/src/lib/auth.ts` legacy cookie | Super Admin auth | LEGACY | `isLegacyAuthenticated` |
| Dual wallet columns in schema notes | Pre-one-wallet | DEPRECATED | `one_wallet_billing.sql` |
| Twilio references in old docs | Historical architecture | DEPRECATED | See blueprint banner |

---

## Experimental / dev-only

| Path | Purpose | Status |
| --- | --- | --- |
| `dashboard/src/app/dev/pronunciation/` | Dev pronunciation page | EXPERIMENTAL |
| `scripts/soniox-tts-listen-harness.js` | Manual TTS QA | EXPERIMENTAL |
| `scripts/tunnel*.js/sh` | Local SautiKit exposure | ACTIVE (dev) |
| ChapterOne fixtures in `tests/` | Retail beachhead scenarios | EXPERIMENTAL (test data) |

---

## Generated / ignored (not inventoried)

| Path | Status |
| --- | --- |
| `node_modules/` | Generated — gitignored |
| `dashboard/.next/` | Generated — gitignored |
| `.env` | Secrets — gitignored |

---

## Architectural entry points (quick reference)

| Task | Start here |
| --- | --- |
| Live call behavior | `server.js` → `mediaWss` handler |
| Voice STT/TTS | `src/speech/` |
| Brain / tools | `src/conversation/` |
| DB write from voice | `src/db.js` |
| Owner settings compile | `dashboard/.../settings/actions.ts` |
| SQL schema change | `docs/supabase/` + README order |
| Lane rules | `AGENTS.md` + `docs/agents/{LANE}.md` |

---

## Related documents

- [`SOURCE_OF_TRUTH.md`](./SOURCE_OF_TRUTH.md)
- [`../architecture/CURRENT_STATE.md`](../architecture/CURRENT_STATE.md)
