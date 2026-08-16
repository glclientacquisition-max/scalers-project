# Beta readiness audit

**Update 2026-08-16:** Production `notify_channels` UPDATE grant applied (`LEDGER-PROD-NOTIFY-GRANT`). See [`PHASE_3H_A3_APPLY_REPORT.md`](./PHASE_3H_A3_APPLY_REPORT.md).

**Date:** 2026-08-15 (Phase 3G)  
**Method:** Codebase + documentation review — no new features implemented  
**MVP scope:** Kenyan home-services / retail voice receptionist with owner desk

---

## Executive summary

Scalers MVP core loops exist and are test-covered at unit/smoke level. Staging database reproducibility is proven. **Beta is feasible for controlled private pilots** with known P1 gaps (notify_channels production grant, storage policy uncertainty, limited CI staging automation until secrets configured).

| Area | Beta-ready? | Top blocker |
| --- | --- | --- |
| Voice answering | **Mostly** | Live call validation operator-dependent |
| Brain / knowledge | **Mostly** | Prompt versioning / traceability (TD-P0-1) |
| Operations / wallet | **Mostly** | `billing_enforcement` default off (by design for beta) |
| Dashboard | **Mostly** | notify_channels save on production |
| Reliability | **Partial** | Monolith, verbose logging, no E2E CI |
| Security | **Mostly** | P1 grant + storage UNKNOWN |

---

## VOICE

| Capability | Status | Severity | Notes |
| --- | --- | --- | --- |
| Call answering (SautiKit webhook) | **READY** | — | `server.js` `/voice/incoming` |
| STT (Soniox) | **READY** | — | Real-time stream path |
| LLM (Gemini) | **READY** | — | Streaming TTS path |
| TTS (Soniox) | **READY** | — | Lexicon + tenant voice pick |
| Latency / turn-taking | **READY** | P2 | Tunable env; see VOICE_SPEED docs |
| Barge-in / interruptions | **READY** | — | `interimBarge`, killAudio |
| Fallback / filler | **READY** | — | `VOICE_GREETING_MODE`, fillers |
| Escalation | **READY** | — | SMS/WhatsApp/email chain |
| Call resolution | **READY** | — | AI + owner correction |
| Live call CI | **GAP** | P1 | Manual DID test required |

---

## BRAIN

| Capability | Status | Severity | Notes |
| --- | --- | --- | --- |
| Tenant knowledge in prompt | **READY** | — | Profile compile path |
| Business profile | **READY** | — | Hours, services, tone |
| FAQs / team directory | **READY** | — | JSON fields |
| Hours / after-hours | **READY** | — | `hours_schedule`, `after_hours_mode` |
| Policies / locations | **READY** | — | `business_operating_model` |
| Unknown-answer handling | **READY** | — | `unknown_answer_fallback` |
| Retail vs home verticals | **READY** | — | Playbook smokes pass |
| Per-call config traceability | **GAP** | P1 | TD-P0-1 |

---

## OPERATIONS

| Capability | Status | Severity | Notes |
| --- | --- | --- | --- |
| Tenant provisioning (signup) | **READY** | — | Fixed #158; staging proven |
| DID assignment | **READY** | P2 | Pool seed manual |
| Wallet / metering | **READY** | — | Beta enforcement off default |
| Billing enforcement | **BY DESIGN OFF** | — | See BETA_WALLET_PROGRAM |
| Notifications (SMS/WA/email) | **READY** | P1 | Production notify_channels grant |
| Appointments | **READY** | — | Table + desk route |
| Contacts / requests | **READY** | — | CRM tables |
| Transcripts | **READY** | — | Utterance model |
| Recordings | **READY** | P1 | Storage policies UNKNOWN |

---

## DASHBOARD

| Area | Status | Severity | Notes |
| --- | --- | --- | --- |
| Onboarding / signup | **READY** | — | |
| Receptionist configuration | **READY** | P1 | notify save on production |
| Calls list / detail | **READY** | — | Recording player |
| CRM (contacts, requests) | **READY** | — | |
| Appointments | **READY** | — | |
| Wallet | **READY** | — | |
| Pronunciation coach | **READY** | P2 | Gemini scan paid API |
| Notification settings | **PARTIAL** | P1 | Grant gap on production |

---

## RELIABILITY

| Area | Status | Severity | Notes |
| --- | --- | --- | --- |
| Webhook ACK / no retry storm | **READY** | — | Immediate 200 on voice webhook |
| DB best-effort on webhook | **READY** | P2 | Logged, non-blocking |
| Idempotent call status | **READY** | — | `updateCallStatus` |
| Provider failure handling | **PARTIAL** | P2 | Gemini retries; SMS fallback |
| `server.js` monolith risk | **GAP** | P2 | TD-P1-1 |
| E2E automated tests | **GAP** | P2 | No browser/call CI |

---

## SECURITY

| Area | Status | Severity | Notes |
| --- | --- | --- | --- |
| Tenant isolation (RLS) | **READY** | — | Post-P0 fix |
| Auth (Supabase) | **READY** | — | |
| service_role boundaries | **READY** | — | Wallet RPCs locked |
| notify_channels grant | **CLOSED** | P1 | Applied 2026-08-16 |
| Storage policies | **UNKNOWN** | P1 | Model documented |
| Legacy Super Admin cookie | **GAP** | P2 | TD-P2-1 |
| Verbose logging / PII | **GAP** | P1 | TD-P1-4 |

---

## Classification summary

| Severity | Count | Examples |
| --- | --- | --- |
| P0 | 0 | Legacy allow-all RLS remediated |
| P1 | 6 | notify grant, storage UNKNOWN, live call CI, traceability, logging, notify desk save |
| P2 | 6 | DID seed, monolith, E2E, Super Admin auth, pronunciation cost, DB webhook best-effort |
| P3 | — | Enhancements deferred |

---

## Related documents

- [`PHASE_3G_COMPLETION_REPORT.md`](./PHASE_3G_COMPLETION_REPORT.md)
- [`../security/PHASE_3F_SECURITY_REVIEW.md`](../security/PHASE_3F_SECURITY_REVIEW.md)
- [`BETA_WALLET_PROGRAM.md`](../BETA_WALLET_PROGRAM.md) (if exists)
