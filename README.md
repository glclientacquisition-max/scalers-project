# Scalers

Scalers ([scalers.co.ke](https://scalers.co.ke)) is a Kenya-focused multi-tenant Business Assistant.

A business gets a phone number. When a call is missed, busy, or after hours, the assistant answers, takes the caller's name and reason, and notifies the owner.

The owner works in the Desk: setup, the call inbox, contacts, approve-first SMS and WhatsApp, and package usage.

## What is live

- Voice on a SautiKit number. Speech is Soniox. Reasoning is Gemini.
- Lead capture on the call, then an owner notify by SMS, WhatsApp, or email when that channel is turned on.
- Desk (Next.js) for setup, the call inbox, contacts, and approve-first text to the caller.
- Package and usage on the Desk. Super Admin assigns packages at `/admin/packages`. Hangup meters included minutes after the package SQL is applied. Beta tenants are metered and not charged while billing enforcement is off. Owner M-Pesa checkout is not shipped.
- Voice runs on Railway. The Desk runs on Vercel. Supabase holds tenants, calls, transcripts, billing, and auth.

## Not shipped

- Live Dial to a person during the call. The shipped handoff is an async notify plus a Desk note. Spec: [`docs/product/LIVE_TRANSFER.md`](docs/product/LIVE_TRANSFER.md).
- Owner self-serve package checkout. See [`docs/operations/PACKAGES.md`](docs/operations/PACKAGES.md).

## Repo map

Two apps, one git repo. They deploy separately. There is no npm workspace.

| Path | What it is |
| --- | --- |
| `server.js` | Voice HTTP server, media websocket, and turn loop. Railway starts this file. Leave it at the repo root. |
| `db.js` | Re-exports `src/db.js`. |
| `src/speech/` | Soniox speech, turn-taking, pronunciation. |
| `src/conversation/` | Brain: tools, playbooks, caller memory. Runtime prompt text is `src/prompts.js`. |
| `src/notifications/` | SMS, WhatsApp, and email. |
| `src/sautikit/` | Webhook guard. |
| `src/billing/` | Package overage and transfer-leg helpers. |
| `src/db.js` | Voice database API. Platform owns this surface. |
| `dashboard/` | Desk and Super Admin. Vercel root directory is `dashboard`. |
| `docs/` | Product, ops, SQL, and lane docs. Start at [`docs/README.md`](docs/README.md). |
| `tests/` | Node tests for voice, brain, and desk units. |
| `scripts/` | Smoke checks, tunnels, and one-off jobs. Index: [`scripts/README.md`](scripts/README.md). |
| `evals/` | Brain eval fixture. Run `npm run eval:brain`. |
| `Dockerfile`, `railway.toml`, `render.yaml` | Voice deploy. Render is the alternate host. |

How the pieces fit, in one page: [`docs/architecture/SYSTEM_ARCHITECTURE.md`](docs/architecture/SYSTEM_ARCHITECTURE.md).

Lanes (Voice, Brain, Desk, Ops & Billing, Platform): [`AGENTS.md`](AGENTS.md).

`server.js` is still one process. The target split is [`docs/architecture/TARGET_MODULE_LAYOUT.md`](docs/architecture/TARGET_MODULE_LAYOUT.md). Do that extract in its own pull request, with no behavior change.

## Run locally

Use Node 22. That is the version in the voice image.

### Voice

```bash
cp .env.example .env
npm ci
npm start
```

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are required to boot. A full call also needs `GEMINI_API_KEY` and `SONIOX_API_KEY`. Copy names from `.env.example`. Do not commit `.env`.

SQL is applied by hand. Order: [`docs/supabase/README.md`](docs/supabase/README.md).

To take a SautiKit test call against your laptop:

```bash
npm run tunnel:cloudflared
```

Steps: [`docs/operations/WEBHOOK_TUNNEL.md`](docs/operations/WEBHOOK_TUNNEL.md).

Optional DB check, when Supabase env is set: `npm run smoke:db`.

### Desk

```bash
cd dashboard
cp .env.example .env.local
npm ci
npm run dev
```

Variable names are in `dashboard/.env.example`. Keep `SUPABASE_SERVICE_ROLE_KEY` on the server. Never put it in a `NEXT_PUBLIC_` variable.

More Desk notes: [`dashboard/README.md`](dashboard/README.md).

## Tests

```bash
npm run test:voice
npm run test:brain
npm run test:mvp
cd dashboard && npm run build
```

Pull requests to `main` run the same commands in [`.github/workflows/ci.yml`](.github/workflows/ci.yml).

## Docs and agents

| Start here | Why |
| --- | --- |
| [`docs/README.md`](docs/README.md) | Where each doc folder lives |
| [`CONTEXT.md`](CONTEXT.md) | Words we use |
| [`AGENTS.md`](AGENTS.md) | Which lane may edit which paths |
| [`docs/architecture/CURRENT_STATE.md`](docs/architecture/CURRENT_STATE.md) | What the system is today |
| [`docs/governance/SOURCE_OF_TRUTH.md`](docs/governance/SOURCE_OF_TRUTH.md) | Which file is canonical |
| [`CONTRIBUTING.md`](CONTRIBUTING.md) | Branch, PR, and test rules |
| [`CHANGELOG.md`](CHANGELOG.md) | Notable changes. Older work is in git, not in version tags. |

## Stack

| Piece | Choice |
| --- | --- |
| Telephony | SautiKit |
| Speech | Soniox STT and TTS |
| Reasoning | Google Gemini |
| Voice process | Node.js, Express, WebSocket, on Railway |
| Desk | Next.js on Vercel |
| Data, auth, files | Supabase |
