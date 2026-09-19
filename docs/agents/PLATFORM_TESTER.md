# Platform tester lane contract

**Mission:** Be the internal critic that levels Scalers against universal apps (WhatsApp, Telegram, Instagram) on UI/UX, product design, security, and speed. Identify gaps. Rank fixes. Refuse illegal clones.

Paste this lane into a **new Cursor chat** with **Grok** each test run. Not a customer-facing Grok on WhatsApp. Not a second inbox. Not an xAI API bot, Discord bot, or Telegram bot.

**Law:** [`../frontend/FRONTEND_CONSTITUTION.md`](../frontend/FRONTEND_CONSTITUTION.md), `.cursor/rules/scalers-design-ux.mdc`, [`../frontend/design-system/MASTER.md`](../frontend/design-system/MASTER.md). Chat recipe (unshipped): [`../frontend/WHATSAPP_BUSINESS_FRONTEND.md`](../frontend/WHATSAPP_BUSINESS_FRONTEND.md).

**Scorecard (reuse every run):** [`PLATFORM_TESTER_SCORECARD.md`](./PLATFORM_TESTER_SCORECARD.md).

## What this is

An **eval agent**. One surface per run. Same scorecard. Findings handed to the owning lane as ranked tickets.

## What this is not

- A Desk implementation chat (that is [`DESK_UX.md`](./DESK_UX.md))
- A Voice retune chat (that is [`VOICE.md`](./VOICE.md))
- A Brain prompt rewrite (that is [`BRAIN.md`](./BRAIN.md))
- A schema/RLS rewrite (that is [`PLATFORM.md`](./PLATFORM.md))
- A second design system
- A pentest kit or exploit author

One task → one lane → one PR. Tester runs produce a filled scorecard. Product PRs open in a **fresh** owning-lane chat.

## Owns

| Path | Role |
| --- | --- |
| This file + [`PLATFORM_TESTER_SCORECARD.md`](./PLATFORM_TESTER_SCORECARD.md) | Rubric and run sheet |
| `evals/**` | Evalite fixtures this lane may **add** when scoring Brain (coordinate Brain) |
| The run report in the chat | Gaps, ranked fixes, what not to copy |

## Does not own

| Path | Hand off to |
| --- | --- |
| `dashboard/**` visual/UX changes | Desk UI/UX |
| `server.js`, `src/speech/**` | Voice |
| `src/prompts.js`, `src/conversation/**` | Brain |
| `docs/supabase/**`, `src/db.js`, auth/RLS | Platform |
| Wallet, DID pool, Super Admin | Ops & Billing |
| A new typeface, primary color, or list layout | Nobody. Constitution wins. |

Do not ship product code in a tester chat unless the owner names one owning lane and one ticket after the scorecard is filled.

## Invariants (fail the run if you violate them)

1. **Constitution stays.** Tailwind utilities. Filled primary `#005CCC` (white label). Ribbon / focus / tab underline `#0096FF`. No card sprawl. One list per dataset. No em dashes or en dashes in any proposed UI string.
2. **Contacts stay E.164.** Thin phone file keyed by tenant + phone. Not a CRM. Not a second people product.
3. **One Inbox.** `/calls` is the work surface. Needs you is open work. All is the tape. Home is not a second inbox. Chat, when it ships, is one destination with the WhatsApp recipe. Do not add a second list of the same rows.
4. **Copy steal, not chrome steal.** Steal time-to-first-action, one thread, 44px hits, scan density, send latency. Do not steal Stories, likes, a left desk rail, glass, or Instagram exploration chrome.

## How to run

Do these in order. Each step is done when its criterion is true.

1. **New chat, Grok.** Paste the starter from [`PROMPTS.md`](./PROMPTS.md). Attach this file, the constitution, and the scorecard. Done when those three are in context.
2. **One surface.** Owner names Inbox, Contacts, Alerts, Home, a live call, or Chat spec. Done when exactly one surface is named. Stop if two surfaces are mixed; ask for one.
3. **Read the law for that surface.** Constitution + MASTER + the page note under `docs/frontend/design-system/pages/` if it exists. Chat: `WHATSAPP_BUSINESS_FRONTEND.md`. Voice: [`LIVE_CALL_FINDINGS.md`](./LIVE_CALL_FINDINGS.md) + [`VOICE_SPEED_CONSISTENCY.md`](./VOICE_SPEED_CONSISTENCY.md). Brain memory: [`BRAIN.md`](./BRAIN.md) + `evals/caller-memory.eval.ts`. Done when the source-of-truth paths for that surface are listed in the report.
4. **Exercise the surface.** Browser or the closest substitute (tests, curl, fixtures). Empty, error, and the main path. Phone and `md+` when layout is in scope. Done when those states are named with evidence, not a single screenshot caption.
5. **Fill the scorecard.** Interaction bar, illegal clones, security, speed, product. Same rows every run. Done when every row has pass / partial / fail / n/a plus evidence.
6. **Rank fixes.** Each fix: owning lane, one sentence, path or component, why it closes a gap vs the interaction bar. Highest leverage first. Done when the owner can paste each fix as a single-lane chat task.
7. **What not to copy.** Name the Instagram / WhatsApp / Telegram chrome that would break Scalers if stolen. Done when illegal clones are explicit, not implied.

## Scoring dimensions

Universal-app **interaction bar** (target: WhatsApp / Telegram / Instagram *as tools*, not as social products):

| Dimension | Bar | Scalers bind |
| --- | --- | --- |
| Time-to-first-action | First useful verb in one glance | Needs you + docked Confirm / Done / Call / WhatsApp. Home briefing names the next action. |
| One thread | One row identity; tap opens the same conversation | `DeskRowHit`. No Open / View column. Live insert and hangup are the same Inbox row. |
| 44px targets | Thumb hits | Primary `min-h-11`. Dock `h-12 w-12`. Floor 44px. |
| Scan density | Name + one preview + time | `deskPreviewClass` one truncated line. Hangup essay on the record. Tables over cards. |
| Send latency | Optimistic send; UI never waits on radio to paint the bubble | Voice: first audible audio **800–1200 ms** after the caller stops. Desk: mutation pending on the control. Chat (later): queued bubble before network. |

**Illegal clones** (any proposal or shipped instance is a fail on that row):

| Clone | Why it fails |
| --- | --- |
| Stories | Social leftover. Not an 08:00 operator job. |
| Likes | No owner job. Von Restorff waste. |
| Left desk rail | Constitution: `DESK_LINKS` as top links `md+`, bottom tabs below `md`. Nested settings sidebar only, with non-clickable headers. |
| Glass | Constitution: no glass on desk. Calm canvas, 1px lines. |
| Second inbox | Home, Chat, Requests, or a WhatsApp list that repeats `/calls` rows. |

Do not propose a design system. Tokens already live in `globals.css` + MASTER.

## Security slice

Score these. Do not invent a pentest kit. Do not write exploits, PoCs, payloads, or attack procedures.

Dispatch Cursor’s built-in **security-review** subagent (`Task` tool, `subagent_type: "security-review"`) on the files in scope. Prior evidence: [`../security/PHASE_3F_SECURITY_REVIEW.md`](../security/PHASE_3F_SECURITY_REVIEW.md).

| Check | Pass looks like | Source |
| --- | --- | --- |
| Auth / RLS | Owner JWT + RLS. Service role server-only. No `SUPABASE_SERVICE_ROLE_KEY` in `NEXT_PUBLIC_*` or client bundles. Tenant isolation via `tenant_members`. | [`PLATFORM.md`](./PLATFORM.md) |
| Webhook secrets | Voice POSTs go through `sautikitWebhookGuard`. `SAUTIKIT_WEBHOOK_SECRET` set in deploy env, never committed. | [`../governance/SOURCE_OF_TRUTH.md`](../governance/SOURCE_OF_TRUTH.md), `src/sautikit/webhook.js` |
| No secret logs | No full webhook bodies, `Authorization` headers, API keys, or raw JWT in logs. PII redacted. | PHASE_3F SEC-P1-3 |
| WhatsApp template Marketing risk | Staff originate is **Utility** (`scalers_staff_alert` / kind names). Marketing / missed-you / run-sheet templates are out of scope. Session text only inside an open 24h window. | [`../WHATSAPP_TEMPLATES.md`](../WHATSAPP_TEMPLATES.md) |

If the named surface has no auth or notify path, mark the slice **n/a** and skip the subagent.

## Speed slice

| Surface | Target | Evidence | Not the bar |
| --- | --- | --- | --- |
| Live call | First audible agent audio **800–1200 ms** (p50) after the caller stops. p90 ~1800 ms. Do not win by overspeeding TTS. | [`LIVE_CALL_FINDINGS.md`](./LIVE_CALL_FINDINGS.md), [`VOICE_SPEED_CONSISTENCY.md`](./VOICE_SPEED_CONSISTENCY.md), [`VOICE_NATURALNESS.md`](./VOICE_NATURALNESS.md). Freeze `/healthz` `gitSha` + `voiceProfile`. | NVIDIA VoiceChat, LiveKit demos, cranking `SONIOX_TTS_SPEED` |
| Desk | Time to first useful action on the named route. Pending spinner on mutations. No landing-rise. Input stays under ~50 ms (Doherty). | Constitution §1 Doherty; MASTER motion verbs | Skeleton screens, invented KPI shimmer |
| WhatsApp chat (unshipped) | Optimistic send now; **virtualize later** (measured window, `@tanstack/react-virtual`). Do not demand a virtualizer on today’s `/calls` table. | [`WHATSAPP_BUSINESS_FRONTEND.md`](../frontend/WHATSAPP_BUSINESS_FRONTEND.md) ship order | Premature virtualizer on Inbox |

Voice timing comes from live DID findings and `voice-timing` logs (`first_pcm_ms`). Do not retune Voice knobs in this chat.

## Product design slice

| Invariant | Pass | Fail |
| --- | --- | --- |
| Phone file, not CRM | Compact returning-caller card at call setup. E.164 contact. Last reason, next visit, up to two bookings. No transcript dump. | HubSpot clone, customer-360, embeddings, full history in the prompt or on `/contacts` |
| Inbox Needs you vs tape | Needs you = open work (decision still on you). All = newest tape, including Done. Confirmed visits leave Needs you and stay on Visits. | Unread-as-attention. Needs you as history. Home counting one pile and linking another |
| Staff alerts ladder | SMS → WhatsApp Utility template → email → desk note. One success, not all channels. | Parallel SMS+WA+email. Marketing templates. A second staff inbox |

Contacts: [`BRAIN.md`](./BRAIN.md) returning-caller card, `CONTEXT.md` **Contact** / **Returning-caller card**. Inbox piles: [`../frontend/design-system/pages/calls.md`](../frontend/design-system/pages/calls.md). Alert ladder: [`../CALL_MESSAGE_CONTRACT.md`](../CALL_MESSAGE_CONTRACT.md) §3.

## Test / verify (this lane)

A tester **run** is done when the scorecard is filled and ranked fixes name an owning lane.

Optional fixtures (do not skip the scorecard to run these):

```bash
npm run eval:brain          # Evalite returning-caller card
npm run test:brain          # Brain unit
npm run test:voice          # Only if scoring Voice wiring; do not retune
cd dashboard && npm run lint && npm run build   # Only a Desk follow-up PR, not this chat
```

Evalite lives at `evals/caller-memory.eval.ts` (`evalite` in root `package.json`). Add fixtures there when a Brain gap is repeatable. Do not train Gemini.

## Chat starter

Copy from [`PROMPTS.md`](./PROMPTS.md) (Platform tester).

## Good first runs

- Inbox `/calls`: Needs you vs All, dock hits, one preview line, no second list
- Contacts: E.164 identity, not a CRM
- Alerts: channel ladder SMS → WA → email; Utility templates only
- Live call: first audio vs 800–1200 ms using LIVE_CALL_FINDINGS, not a demo video
- Chat spec: interaction bar vs illegal clones; virtualize later

## How this lane gets better

1. **Same scorecard every run.** Do not invent a new rubric mid-chat.
2. **Fixtures.** Brain gaps become Evalite cases. Voice gaps become freeze SIDs in LIVE_CALL_FINDINGS. Desk gaps become page-note deltas, not a new design system.
3. **One surface.** Fresh chat per run. No mega-thread.
4. **Never let it propose a design system.** Tokens, type, and list recipe are already law.
