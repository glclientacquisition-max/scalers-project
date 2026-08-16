# Phase 3H beta readiness plan

**Date:** 2026-08-15  
**Status:** IN PROGRESS (execution started 2026-08-16)  
**Production ALCR:** Grant A3 applied 2026-08-16. No other production SQL in this phase.  
**Apply report:** [`PHASE_3H_A3_APPLY_REPORT.md`](./PHASE_3H_A3_APPLY_REPORT.md)

---

## 0. Current state (verified 2026-08-15)

### Git

| Item | Value |
| --- | --- |
| `origin/main` | `edf72fc` — Phase 3G merged (#161) |
| PR #160 (Phase 3F) | **MERGED** |
| PR #161 (Phase 3G) | **MERGED** |
| Working branch for this plan | `cursor/phase-3h-beta-readiness-plan-d058` |
| Working tree | Clean (plan doc only) |

### CI

| Check | Status |
| --- | --- |
| PR CI (`ci.yml`) | **PASS** on #161 — voice, MVP, desk lint/build |
| Staging validation workflow | Present; requires `STAGING_SUPABASE_*` GitHub secrets |
| `npm run release:candidate` | Available locally |
| `npm run verify:staging-schema` | Available; staging-only |

### Environments

| Env | Database | Deploy URL |
| --- | --- | --- |
| Staging | `sgcdncjxauhsbunobmob` — rebuilt from Git (3E) | **UNKNOWN** (no dedicated Railway/Vercel staging URL in repo) |
| Production | `fjxcdccgyhnvnnlnovcl` (ALCR) — untouched | **INFERENCE:** Railway voice + Vercel desk |

### What is proven

- Greenfield DB reproducibility on staging (3E)
- Signup provisioning after #158
- `smoke:db`, `test:voice`, `test:mvp`, desk build
- PR quality gate automation (3G)
- Governance: evolution model, apply order, release gate, environment contract

### What is not proven

- Full 22-step real-business E2E on staging with live call
- Production desk notify-channel persistence
- Production storage policy state
- Per-call agent configuration traceability
- Latency p50/p90 on live Kenyan mobile calls at scale

---

## 1. Remaining blockers (from BETA_READINESS_AUDIT only)

### P0 — launch blockers

| # | Item | Status |
| --- | --- | --- |
| — | None open | Legacy allow-all RLS remediated (#154) |

### P1 — serious (prioritized six)

#### P1-1: `notify_channels` UPDATE grant missing on production

| Field | Detail |
| --- | --- |
| **Problem** | Owners cannot persist notification channel toggles on production |
| **Evidence** | `foundation_bootstrap.sql` §6 comment; `PRODUCTION_CHANGE_NOTIFY_CHANNELS.md`; desk `settings/actions.ts` patches `notify_channels` |
| **Production impact** | Desk save fails or silently omits notify prefs |
| **Staging impact** | **Works** — test grant applied 3E |
| **Proposed fix** | `production_pending/grant_notify_channels_update.sql` (human-approved apply) |
| **Production change required** | **YES** — column grant only |
| **Rollback** | `REVOKE UPDATE (notify_channels) ON public.tenants FROM authenticated` |
| **Validation** | Owner JWT save → reload settings; `npm run test:mvp` (notifyChannels tests) |

**Trace verified (Phase 3H):**

```
TenantForm (notify_channels JSON field)
  → settings/actions.ts saveTenantSettings()
  → createWorkspaceDataClient() → owner mode → createSupabaseServerClient() (authenticated JWT)
  → supabase.from("tenants").update({ notify_channels, ... }).eq("id", tenant.id)
  → RLS: tenants_update_member (member scope) ✓
  → Column privilege: notify_channels NOT in foundation_bootstrap grant list ✗
```

**Verdict:** Prepared SQL is **correct** for the Desk path. No RLS change needed.

---

#### P1-2: Storage policies UNKNOWN

| Field | Detail |
| --- | --- |
| **Problem** | `call-recordings` bucket policy state not in Git; production state unknown |
| **Evidence** | `STORAGE_SECURITY_MODEL.md`; staging has 0 storage policies; smoke upload works via service_role |
| **Production impact** | **UNKNOWN** — voice upload inferred working; defense-in-depth uncertain |
| **Staging impact** | Upload/playback via signed URL works in smoke |
| **Proposed fix** | **Do not apply** `storage_call_recordings_policies.sql` until production policy state is read-only audited |
| **Production change required** | **UNKNOWN** — may be none if current path is sufficient |
| **Rollback** | Drop policies if applied |
| **Validation** | `smoke:db` upload; desk `CallAudioPlayer`; 7-day signed URL playback |

**Application trace (FACT):**

| Step | Path |
| --- | --- |
| Upload | Voice `service_role` → `uploadRecordingBuffer()` → `{callSid}/{recordingSid}.ext` |
| URL | `createSignedUrl` 7-day TTL → `calls.recording_url` |
| Desk read | `CallAudioPlayer` fetches `recording_url` directly (no Storage API from browser) |
| Gemini scan | Server-side `fetch(recording_url)` |

**Verdict:** Current app does **not require** authenticated Storage API access. Signed URLs are the read path. Policy SQL is **optional hardening**, not a confirmed beta blocker unless audit finds a gap.

---

#### P1-3: No live-call validation gate

| Field | Detail |
| --- | --- |
| **Problem** | Voice behavior validated by unit tests only; no automated live DID smoke |
| **Evidence** | `BETA_READINESS_AUDIT.md`; no call CI in repo |
| **Production impact** | Regressions in STT/TTS/turn-taking reach beta tenants undetected |
| **Staging impact** | Same without manual call |
| **Proposed fix** | Manual E2E matrix (Section 3); optional scheduled operator smoke checklist |
| **Production change required** | **NO** |
| **Rollback** | N/A |
| **Validation** | Controlled test DID call with recorded evidence |

---

#### P1-4: Per-call agent config traceability (TD-P0-1)

| Field | Detail |
| --- | --- |
| **Problem** | Cannot answer which prompt/config handled a call |
| **Evidence** | `TECHNICAL_DEBT.md` TD-P0-1; no `prompt_hash` on `calls` |
| **Production impact** | Support/debug/compliance attribution blocked |
| **Staging impact** | Same |
| **Proposed fix** | Future: `call_agent_snapshots` or `calls` metadata columns (separate feature) |
| **Production change required** | **YES** (when implemented) — not for notify grant |
| **Rollback** | Column additive only |
| **Validation** | Post-call query shows config snapshot |

**Beta note:** Blocks **operational trust at scale**, not first pilot if operator monitors manually.

---

#### P1-5: Verbose logging / PII exposure (TD-P1-4)

| Field | Detail |
| --- | --- |
| **Problem** | Full HTTP headers and raw webhook bodies logged |
| **Evidence** | `server.js` lines ~165–166, ~602, ~701; `TECHNICAL_DEBT.md` |
| **Production impact** | PII/credentials in Railway log sinks |
| **Staging impact** | Same |
| **Proposed fix** | Redact logging in dedicated Voice PR (approved behavior change) |
| **Production change required** | **NO** — code deploy only |
| **Rollback** | Revert deploy |
| **Validation** | Log sample review after test call |

---

#### P1-6: Staging CI secrets not configured

| Field | Detail |
| --- | --- |
| **Problem** | Post-merge `staging-validate.yml` soft-skips without secrets |
| **Evidence** | `PHASE_3G_COMPLETION_REPORT.md` |
| **Production impact** | None directly |
| **Staging impact** | No automated smoke/schema on merge |
| **Proposed fix** | Configure `STAGING_SUPABASE_URL` + `STAGING_SUPABASE_SERVICE_ROLE_KEY` in GitHub (same values as operator-provided staging keys — confirmed unchanged 2026-08-15) |
| **Production change required** | **NO** |
| **Rollback** | Remove secrets |
| **Validation** | Green staging workflow on push to `main` |

**Local validation (2026-08-15):** Operator confirmed staging keys unchanged. `.env` points at `sgcdncjxauhsbunobmob` (not ALCR). `npm run smoke:db` **PASS**. `npm run verify:staging-schema` **PASS**.

**GitHub secrets to set (repository settings → Secrets → Actions):**

| Secret | Value |
| --- | --- |
| `STAGING_SUPABASE_URL` | `https://sgcdncjxauhsbunobmob.supabase.co` |
| `STAGING_SUPABASE_SERVICE_ROLE_KEY` | Same service_role key provided for staging (unchanged) |

Optional: `STAGING_DATABASE_URL` for full catalog mode in CI.

---

### P2 — should fix (deferred backlog, not beta blockers)

| Item | Source |
| --- | --- |
| DID pool manual seed for signup auto-assign | 3E staging report |
| `server.js` monolith | TD-P1-1 |
| No browser E2E CI | 3G audit |
| Legacy Super Admin cookie auth | TD-P2-1 |
| Pronunciation Gemini scan cost | Desk feature |
| DB best-effort on voice webhook | Reliability note |
| Dedicated staging Railway/Vercel URLs undocumented | ENVIRONMENT_CONTRACT |

### P3 — enhancement (explicitly deferred)

| Item | Notes |
| --- | --- |
| Package name drift | TD-P3-2 |
| Hardcoded Railway URL default | TD-P3-3 |
| Signed URL refresh after 7 days | Storage model |
| npm workspaces | TD-P3-5 |

---

## 2. Production-pending changes

| Artifact | Ready for approval? | Recommendation |
| --- | --- | --- |
| `grant_notify_channels_update.sql` | **YES** | Approve for production after staging desk E2E + release gate |
| `storage_call_recordings_policies.sql` | **NO** | Mark **UNKNOWN** until read-only production storage audit; not required for current signed-URL path |

---

## 3. Real-business E2E test matrix

**Environment:** Staging preferred (`sgcdncjxauhsbunobmob`). Live call requires test DID + voice deploy URL.

| # | Step | Expected behavior | Test method | Pass criteria | Evidence |
| --- | --- | --- | --- | --- | --- |
| 1 | Business signs up | Auth user + tenant provisioned | Desk signup flow | `auth.users`, `tenant_members`, `tenants` row | DB query / screenshot |
| 2 | Tenant provisioned | Business name, defaults, voice langs | Post-signup inspect tenant | `voice_languages` default; `agent_name` set | DB |
| 3 | DID assigned | Virtual number on tenant | Signup with pool seed | `sautikit_virtual_number` populated | DB |
| 4 | Configure receptionist | Agent name, tone, prompt compile | Desk Settings save | Reload shows values | UI + DB |
| 5 | Configure hours | `hours_schedule` persisted | Settings → Hours | Open/closed correct in prompt | UI + DB |
| 6 | Configure services | `services_catalog` saved | Settings → Services | Catalog in DB | UI + DB |
| 7 | Configure FAQs | `faqs` jsonb saved | Settings → FAQs | FAQs in DB | UI + DB |
| 8 | Configure notify prefs | `notify_channels` toggles saved | Settings → Notifications | Reload matches toggles | UI + DB — **blocked on prod until P1-1** |
| 9 | Configure voice | Soniox voice + lexicon | Settings → Voice / Pronunciation | Preview plays; lexicon saved | UI |
| 10 | Receive real call | Webhook → media session | Test DID inbound | Call row created `in_progress` | DB + logs |
| 11 | Receptionist answers | Greeting audio within target | Listen on call | First PCM ≤ 1200 ms p50 target | Recording + `voice-timing` log |
| 12 | Normal question | Accurate answer from knowledge | Ask hours/service | Correct info, no hallucination | Transcript review |
| 13 | Service request | Captures intent | Ask for plumbing visit | Request or appointment flow started | Transcript + CRM |
| 14 | Appointment request | Appointment row or handoff | Book visit | `appointments` row or escalate | DB |
| 15 | Contact info | Name/number captured | Provide name + callback | `calls` summary / contacts | DB |
| 16 | Escalation | SMS/WA/email when appropriate | Request human urgently | Notification dispatched once | TextSMS/logs |
| 17 | Notification sent | Owner receives alert | After escalation/lead | `whatsapp_sent` or SMS log | DB + provider |
| 18 | Recording/transcript | Utterances + recording URL | Complete call | `transcripts` rows; `recording_url` set | DB + playback |
| 19 | Call in Desk | List + detail correct | Desk → Calls | Matches live call | UI |
| 20 | Resolution stored | `resolution`, `primary_intent` | Review call detail | Fields populated | DB |
| 21 | Wallet usage | Meter/charge per beta mode | Complete billed-length call | Ledger row or meter log | `wallet_ledger` / logs |
| 22 | Business review | Owner can replay + understand | Desk call detail | Audio plays; transcript readable | UI |

**Matrix status today:** Steps 1–7, 9–22 are **testable** on staging with setup. Step 8 **passes on staging**, **fails on production** until P1-1. Steps 10–18 require **manual live call** (P1-3).

---

## 4. Voice evaluation framework

**Principle:** Measure before changing Soniox/Gemini/TTS config.

### Scoring (1–5 per criterion, per call)

| Criterion | What to observe |
| --- | --- |
| Naturalness | Prosody, pacing, not robotic |
| Kenyan English clarity | Understandable on mobile |
| Swahili clarity | Correct language choice and pronunciation |
| Sheng (if enabled) | Appropriate code-switch, not garbled |
| Interruptions / barge-in | Caller can interrupt; agent stops |
| Response latency | `first_pcm_ms` from `voice-timing` logs |
| Turn-taking | No talk-over, no long dead air |
| Greeting quality | Correct business name; instant mode |
| Number pronunciation | Phone, prices, times |
| Names / addresses | Business-specific terms from lexicon |
| Business terminology | Services, locations from catalog |

### Repeatable suite

| Asset | Location |
| --- | --- |
| Unit tests | `npm run test:voice` (TTS, turns, timing markers, STT context) |
| TTS listen harness | `npm run tts:listen-harness` (operator listening) |
| Live DID script | **PROPOSED:** `docs/operations/beta_voice_eval_checklist.md` (Phase 3H implementation) |
| Targets | `docs/agents/VOICE_SPEED_CONSISTENCY.md` — p50 first PCM 800–1200 ms |

**Do not** change provider or model until baseline scores recorded for ≥ 3 calls.

---

## 5. Brain evaluation framework

### Scoring (pass/fail + notes per scenario)

| Criterion | Test approach |
| --- | --- |
| Instruction following | Scripted caller lines vs expected behavior |
| Business knowledge accuracy | Questions with known FAQ/hours answers |
| Hallucination resistance | Ask for non-existent service |
| Unknown-answer behavior | Obscure question → fallback phrase |
| Escalation behavior | Angry caller / explicit human request |
| Appointment handling | Home-services playbook smoke + live |
| Service request handling | `smoke:home`, `smoke:retail` |
| Caller info validation | Name/number repetition |
| In-call context | Multi-turn reference ("that time you said…") |
| Tool selection | end_call, escalate, appointment tools |
| Call resolution | `resolution` / `primary_intent` populated |
| Graceful failure | Gemini timeout → filler or apology |

### Repeatable suite

| Command | Coverage |
| --- | --- |
| `npm run test:mvp` | Brain, knowledge, playbooks, escalation, notify |
| `npm run test:brain` | Core conversation, tools, safety |
| `npm run smoke:home` / `smoke:retail` | Vertical scripts |

**Do not** rewrite prompts until baseline transcript review completed.

---

## 6. Latency budget

Targets from `VOICE_SPEED_CONSISTENCY.md`. **Actual values require live measurement** — fill during first beta E2E calls.

| Component | Target (p50) | Target (p90) | Actual (measured) | Delta | Measurement source |
| --- | ---: | ---: | ---: | ---: | --- |
| STT endpoint + flush | 300–900 ms | ≤ 1200 ms | **UNKNOWN** | — | `voice-timing` `endpoint_to_llm_ms` |
| Brain (Gemini first token) | 300–800 ms | ≤ 1500 ms | **UNKNOWN** | — | `voice-timing` logs |
| Tool execution | < 500 ms | < 1000 ms | **UNKNOWN** | — | Server logs around tool calls |
| TTS (first PCM) | 100–300 ms | ≤ 500 ms | **UNKNOWN** | — | `first_pcm_ms`, `chunk_to_pcm_ms` |
| Network / relay | — | — | **UNKNOWN** | — | SautiKit + WebSocket (hard to split) |
| **Total (caller stop → first audio)** | **800–1200 ms** | **≤ 1800 ms** | **UNKNOWN** | — | `first_pcm_ms` |

**Dominant contributor:** **UNKNOWN until measured.** Engineering hypothesis (3F/VOICE docs): stream buffer + serial TTS setup historically dominated; prefetch and early flush already shipped.

**Rule:** Do not optimize components until one live-call log sample identifies the largest `voice-timing` gap.

---

## 7. Observability gaps

### Questions we must answer per call

| Question | Answerable today? | Source |
| --- | --- | --- |
| Which tenant? | **YES** | `calls.tenant_id` |
| Which DID? | **YES** | `tenants.sautikit_virtual_number` + webhook payload |
| What happened? | **PARTIAL** | Transcripts; verbose logs |
| Intent detected? | **PARTIAL** | `calls.primary_intent`, `resolution` |
| Tools executed? | **PARTIAL** | Server logs (not structured DB) |
| Escalation attempted? | **PARTIAL** | Logs + `whatsapp_sent` |
| Notification sent? | **PARTIAL** | SMS/WhatsApp logs |
| Stage timings? | **PARTIAL** | `voice-timing` stdout logs |
| Call cost? | **PARTIAL** | `wallet_ledger` if charging enabled |
| Wallet charged? | **YES** (if enabled) | `charge_call_to_wallet` RPC |
| Failures? | **PARTIAL** | Railway logs; no error table |
| Why failed? | **WEAK** | Stack traces in logs only |

### Logging hygiene (P1-5)

| Risk | Location | Action |
| --- | --- | --- |
| Full request headers | `server.js` ~165 | Redact |
| Raw webhook bodies | `server.js` ~602, ~701 | Truncate + redact PII |
| WS payloads | `server.js` ~1910 | Sample only |

**Do not** weaken logging to zero — structured summary logs replace raw dumps.

---

## 8. Beta tenant safety model

Use existing `tenants` fields — no new tables required for first pilots.

| Control | Mechanism |
| --- | --- |
| Beta status | `billing_enforcement = 'off'` (default) — `BETA_WALLET_PROGRAM.md` |
| Metering | Wallet RPCs may still record; no block |
| Wallet limits | `wallet_low_balance_kes`; alerts via `wallet_on_demand_alerts` |
| Support path | **PROPOSED:** `beta_notes` text field + external support channel (ops) |
| Onboarding state | Desk onboarding route; `tenant_members` owner row |
| Test vs production DID | Ops documents per tenant in `beta_notes`; pool assignment |
| Voice config | `soniox_voice_id`, `tts_lexicon`, `voice_languages` |
| Notify config | `notify_channels` (after P1-1 on production) |

### Beta tenant checklist (per business)

- [ ] `billing_enforcement = off` confirmed
- [ ] Test or production DID documented
- [ ] Owner notify numbers verified
- [ ] `notify_channels` saved and reloaded
- [ ] One successful live call recorded
- [ ] Operator review of transcript + wallet meter

---

## 9. Feature development lifecycle (Phase 3H onward)

Extends `FEATURE_DEVELOPMENT_CONTRACT.md`:

```
IDEA → SPEC → IMPACT ANALYSIS → DB CHANGE (if any) → IMPLEMENT
  → UNIT TEST → STAGING → E2E → OBSERVABILITY → RELEASE GATE
  → PRODUCTION → MEASURE → ITERATE
```

Every feature gets `docs/features/<feature>.md`:

| Section | Required |
| --- | --- |
| Problem | Yes |
| User | Yes |
| Desired behavior | Yes |
| Non-goals | Yes |
| Architecture impact | Yes |
| Database impact | Yes / N/A |
| Security impact | Yes |
| UX impact | If desk-facing |
| Test plan | Yes |
| Rollout plan | Yes |
| Rollback plan | Yes |
| Success metrics | Yes |

**Phase 3H:** Template only — first feature doc created when first feature is approved.

---

## 10. Prioritized implementation sequence

Only three categories. **No implementation until this plan is approved.**

### A. Beta blockers (do first)

| Order | Item | Type | Status |
| --- | --- | --- | --- |
| A1 | Configure staging GitHub secrets | Ops | **DONE** (CI green) |
| A2 | Run full E2E matrix on staging (incl. live call) | Validation | Open |
| A3 | Approve + apply `grant_notify_channels_update.sql` | DB grant | **DONE** 2026-08-16 |
| A4 | Desk notify save E2E on production post-grant | Validation | Open |
| A5 | Live-call beta checklist (3+ calls, voice/brain scores) | Validation | Open |

### B. Reliability

| Order | Item | Type | Status |
| --- | --- | --- | --- |
| B1 | Redact verbose logging (P1-5) | Code | **DONE** #165 |
| B2 | Seed staging DID pool for signup tests | Ops/staging SQL | Open |
| B3 | Document staging voice/desk deploy URLs | Docs/ops | **DONE** `STAGING_TO_PRODUCTION.md` |

### C. Customer value (after A stable)

| Order | Item | Type |
| --- | --- | --- |
| C1 | Per-call config snapshot (TD-P0-1) | Feature + DB |
| C2 | Structured tool/outcome logging | Observability |
| C3 | Product features from beta feedback | Per `docs/features/*.md` |

### Deferred backlog (not Phase 3H)

- Storage policy SQL (pending audit)
- Supabase CLI migration cutover
- Browser E2E CI
- `server.js` extraction
- Super Admin RBAC migration

---

## 11. Definition of Done — Phase 3H

Phase 3H is **complete** when:

1. This plan is reviewed and approved.
2. Staging secrets configured and `staging-validate.yml` green on `main`.
3. E2E matrix executed on staging with evidence for ≥ steps 1–9, 18–22.
4. ≥ 1 live test call on staging with `voice-timing` logs captured.
5. Voice + brain baseline evaluation scores recorded (not optimized yet).
6. Latency budget table filled with at least one measured row.
7. `grant_notify_channels_update.sql` applied to production **YES** 2026-08-16. A4 desk save still required.
8. Logging redaction PR scoped (may land Phase 3H+1).
9. First `docs/features/<feature>.md` created only when a feature is approved.

**Phase 3H does NOT require:** storage policy apply, provider migration, or new product features.

---

## 12. Executive summary

### PHASE 3H STATUS: **READY WITH CONDITIONS**

Scalers is **technically reproducible** and **governance-complete** after Phases 3E–3G. It is **not yet operationally proven** for real-business beta until live E2E validation and the production `notify_channels` grant are closed.

### Top 5 actions

1. **Configure staging GitHub secrets** and confirm post-merge validation is green.
2. **Execute the 22-step E2E matrix on staging**, including ≥ 1 live test call with evidence.
3. **Human-approve and apply** `grant_notify_channels_update.sql` on production; verify desk notify save.
4. **Record voice/brain baseline scores** and fill latency budget from `voice-timing` logs (measure, do not tune).
5. **Scope logging redaction PR** to remove raw headers/webhook bodies (P1-5).

### Do NOT do yet

1. **Do not apply** `storage_call_recordings_policies.sql` without read-only production storage audit.
2. **Do not replace** Soniox, Gemini, or rewrite the voice pipeline.
3. **Do not add** product features until E2E matrix passes and beta tenant checklist is green.

---

## Related documents

- [`BETA_READINESS_AUDIT.md`](./BETA_READINESS_AUDIT.md)
- [`PHASE_3G_COMPLETION_REPORT.md`](./PHASE_3G_COMPLETION_REPORT.md)
- [`PRODUCTION_CHANGE_NOTIFY_CHANNELS.md`](./PRODUCTION_CHANGE_NOTIFY_CHANNELS.md)
- [`../storage/STORAGE_SECURITY_MODEL.md`](../storage/STORAGE_SECURITY_MODEL.md)
- [`../engineering/FEATURE_DEVELOPMENT_CONTRACT.md`](../engineering/FEATURE_DEVELOPMENT_CONTRACT.md)
- [`../agents/VOICE_SPEED_CONSISTENCY.md`](../agents/VOICE_SPEED_CONSISTENCY.md)
