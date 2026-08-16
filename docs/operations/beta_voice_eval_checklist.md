# Beta evaluation checklists

**Status:** Operator fill-in (Phase 3H A2, A4, A5)  
**Environment default:** Staging Desk `https://scalers-staging.vercel.app` + staging Voice `https://scalers-staging-staging.up.railway.app` + DB `sgcdncjxauhsbunobmob`  
**Production Desk (A4 only):** `https://scalers-project.vercel.app`  
**Rule:** Measure. Do not retune Soniox, Gemini, or TTS until three scored calls exist.

Copy a row into notes. Attach call SID, screenshot, or log snippet as evidence.

---

## A4. Production notify save

Do this once on production after the `notify_channels` grant.

| # | Step | Pass? | Evidence |
| --- | --- | --- | --- |
| 1 | Sign in on `https://scalers-project.vercel.app` as an owner | | |
| 2 | Settings, Notifications: flip one channel | | |
| 3 | Save. No `notify_channels` error | | |
| 4 | Reload. Toggle still matches | | |

Fail: capture the exact Desk error. Rollback is `REVOKE UPDATE (notify_channels) ON public.tenants FROM authenticated`.

---

## A2. Staging E2E matrix (22 steps)

Prefer staging. Live call needs a **staging test DID**, not a production customer DID.

| # | Step | Pass? | Evidence |
| --- | --- | --- | --- |
| 1 | Business signs up | | `auth.users` + `tenant_members` + `tenants` |
| 2 | Tenant defaults (name, voice langs, agent name) | | DB row |
| 3 | DID assigned (`sautikit_virtual_number`) | | DB. Blocked if pool empty (B2) |
| 4 | Receptionist settings save + reload | | UI + DB |
| 5 | Hours persist | | `hours_schedule` |
| 6 | Services persist | | `services_catalog` |
| 7 | FAQs persist | | `faqs` |
| 8 | Notify prefs persist | | `notify_channels` (works on staging; A4 covers production) |
| 9 | Voice + lexicon. Preview plays | | UI |
| 10 | Inbound test call. Call row `in_progress` | | DB + Railway log |
| 11 | Greeting audio. First PCM target 800–1200 ms p50 | | Recording + `voice-timing` |
| 12 | Known hours/service question. Accurate, no invented facts | | Transcript |
| 13 | Service request captured | | Transcript + CRM |
| 14 | Appointment row or escalate | | `appointments` or notify log |
| 15 | Name + callback captured | | `calls` / contacts |
| 16 | Urgent human request. One escalation | | SMS/WA/email |
| 17 | Owner receives alert | | `whatsapp_sent` or SMS log |
| 18 | Transcripts + `recording_url` | | DB + playback |
| 19 | Desk Calls list + detail match the live call | | UI |
| 20 | `resolution` + `primary_intent` set | | DB |
| 21 | Wallet meter (beta: enforcement off) | | `wallet_ledger` or meter log |
| 22 | Owner can replay audio and read transcript | | UI |

Minimum close-out: steps 1–9 and 18–22 with evidence, plus at least one live call covering 10–18.

---

## A5. Live-call scorecard (repeat 3 times)

One sheet per call. Fill latency from `voice-timing` logs. Do not change provider config.

**Call SID:**  
**DID:**  
**Tenant:**  
**Date (UTC):**  
**Env:** staging / production test DID

### Voice (1–5)

| Criterion | Score | Notes |
| --- | --- | --- |
| Naturalness | | |
| Kenyan English clarity | | |
| Swahili clarity | | |
| Sheng (if enabled) | | |
| Interruptions / barge-in | | |
| Response latency | | |
| Turn-taking | | |
| Greeting quality | | |
| Number pronunciation | | |
| Names / addresses | | |
| Business terminology | | |

### Brain (pass / fail)

| Criterion | Result | Notes |
| --- | --- | --- |
| Instruction following | | |
| Business knowledge accuracy | | |
| Hallucination resistance | | |
| Unknown-answer fallback | | |
| Escalation behavior | | |
| Appointment handling | | |
| Service request handling | | |
| Caller info validation | | |
| Multi-turn context | | |
| Tool selection | | |
| Call resolution populated | | |
| Graceful failure | | |

### Latency (ms)

| Component | Target p50 | Target p90 | This call | Source |
| --- | ---: | ---: | ---: | --- |
| STT endpoint + flush | 300–900 | ≤ 1200 | | `endpoint_to_llm_ms` |
| Brain first token | 300–800 | ≤ 1500 | | `voice-timing` |
| Tool execution | < 500 | < 1000 | | tool logs |
| TTS first PCM | 100–300 | ≤ 500 | | `chunk_to_pcm_ms` |
| **Caller stop → first audio** | **800–1200** | **≤ 1800** | | `first_pcm_ms` |

Dominant stage this call:

---

## Per-tenant beta gate

Use before a real business goes live.

- [ ] `billing_enforcement = off`
- [ ] Test vs production DID written down
- [ ] Owner notify numbers verified
- [ ] `notify_channels` saved and reloaded (A4 on production)
- [ ] One successful live call recorded
- [ ] Transcript + wallet meter reviewed

---

## Related

- [`PHASE_3H_BETA_READINESS_PLAN.md`](./PHASE_3H_BETA_READINESS_PLAN.md)
- [`PRODUCTION_CHANGE_NOTIFY_CHANNELS.md`](./PRODUCTION_CHANGE_NOTIFY_CHANNELS.md)
- [`../agents/VOICE_SPEED_CONSISTENCY.md`](../agents/VOICE_SPEED_CONSISTENCY.md)
- [`STAGING_TO_PRODUCTION.md`](./STAGING_TO_PRODUCTION.md)
