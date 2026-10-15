# Platform tester scorecard

**Reuse every run.** Copy the run sheet into the chat reply. Do not add rows. Do not drop rows. Mark **n/a** when the named surface has no path to that check.

**Lane:** [`PLATFORM_TESTER.md`](./PLATFORM_TESTER.md)  
**Law:** [`../frontend/FRONTEND_CONSTITUTION.md`](../frontend/FRONTEND_CONSTITUTION.md)  
**Date:** YYYY-MM-DD  
**Surface:** Inbox / Contacts / Alerts / Home / live call / Chat spec  
**Evidence:** routes, files, SHA / `gitSha`, fixture names

---

## Interaction bar (0 fail / 1 partial / 2 pass)

Target is WhatsApp, Telegram, Instagram **as tools**: fast first action, one thread, thumb hits, scan, send. Not their social products.

| Dimension | Score | Evidence | Gap vs bar |
| --- | --- | --- | --- |
| Time-to-first-action | 0 / 1 / 2 |  |  |
| One thread | 0 / 1 / 2 |  |  |
| 44px targets | 0 / 1 / 2 |  |  |
| Scan density | 0 / 1 / 2 |  |  |
| Send latency | 0 / 1 / 2 |  |  |

Voice send latency: first audible audio 800–1200 ms after the caller stops ([`LIVE_CALL_FINDINGS.md`](./LIVE_CALL_FINDINGS.md), [`VOICE_SPEED_CONSISTENCY.md`](./VOICE_SPEED_CONSISTENCY.md)). Chat send: optimistic bubble; virtualize **later**. Desk send: pending on the control, not a page wait.

---

## Illegal clones (0 clean / fail if shipped or proposed)

| Clone | 0 or fail | Evidence (shipped path or proposed line) |
| --- | --- | --- |
| Stories |  |  |
| Likes |  |  |
| Left desk rail |  |  |
| Glass |  |  |
| Second inbox |  |  |

A fail here blocks the ranked-fix list until the clone is withdrawn. Do not “partial” a clone.

---

## Security (pass / fail / n/a)

Dispatch Cursor **security-review** (`subagent_type: "security-review"`). Do not write exploits or a pentest kit. Prior: [`../security/PHASE_3F_SECURITY_REVIEW.md`](../security/PHASE_3F_SECURITY_REVIEW.md).

| Check | Result | Evidence |
| --- | --- | --- |
| Auth / RLS (owner JWT, service role server-only) |  |  |
| Webhook secrets (`sautikitWebhookGuard`, `SAUTIKIT_WEBHOOK_SECRET`) |  |  |
| No secret / PII logs |  |  |
| WhatsApp template Marketing risk (staff = Utility only) |  |  |

---

## Speed (pass / fail / n/a)

| Check | Result | Evidence |
| --- | --- | --- |
| Voice first audio 800–1200 ms (not NVIDIA VoiceChat) |  | SHA, SID, `first_pcm_ms` |
| Desk time to first useful action |  | Route, device |
| WhatsApp virtualize later (not demanded on `/calls`) |  |  |

---

## Product design (pass / fail / n/a)

| Check | Result | Evidence |
| --- | --- | --- |
| Phone file, not CRM (E.164 contact, compact card, no transcript dump) |  |  |
| Inbox Needs you (open work) vs All (tape) |  |  |
| Staff alerts SMS → WhatsApp → email → desk note (one success) |  |  |

---

## Ranked fixes

Highest leverage first. Each line is one future lane chat.

| # | Lane | Fix (one sentence) | Path | Closes |
| --- | --- | --- | --- | --- |
| 1 | Desk / Voice / Brain / Platform / Ops |  |  |  |
| 2 |  |  |  |  |
| 3 |  |  |  |  |

Do not implement these in the tester chat.

---

## What not to copy

- 
- 
- 

---

## Fixtures to add next (optional)

| Kind | Name | Command or file |
| --- | --- | --- |
| Evalite |  | `evals/caller-memory.eval.ts` / `npm run eval:brain` |
| Voice freeze |  | `LIVE_CALL_FINDINGS.md` SID + SHA |
| Desk page note |  | `docs/frontend/design-system/pages/` |

Never: a new design system, a second primary color, a second list of the same dataset.
