# src/ — Voice runtime and Brain

Rules for code under `src/` (and `server.js`, `db.js`). Root rules in [`../AGENTS.md`](../AGENTS.md) still apply.

## Lanes

| Path | Lane | Contract |
| --- | --- | --- |
| `src/speech/**`, `src/sautikit/**`, `server.js` media/turn loop | Voice | [`docs/reference/lanes/VOICE.md`](../docs/reference/lanes/VOICE.md) |
| `src/conversation/**`, `src/prompts.js` | Brain | [`docs/reference/lanes/BRAIN.md`](../docs/reference/lanes/BRAIN.md) |
| `src/billing/**` | Ops & Billing | [`docs/reference/lanes/OPS_BILLING.md`](../docs/reference/lanes/OPS_BILLING.md) |
| `src/db.js`, `src/lib/**`, schema/RPC | Platform | [`docs/reference/lanes/PLATFORM.md`](../docs/reference/lanes/PLATFORM.md) |
| `src/notifications/**` | Voice (send path) + Platform (ops alerts) | |

## Commands

- `npm run test:voice`, `npm run test:brain`, `npm run test:mvp` (Node 22, `SAUTIKIT_API_KEY` unset for tests).
- New `process.env` read? Run `npm run docs:reference` and commit `docs/reference/env.md`.

## Rules

- Every new behaviour ships behind a flag that defaults off; say the flag name in the PR.
- Ops alert kinds live in `src/notifications/platformOpsAlert.js`. A new kind needs a runbook in `docs/runbooks/` in the same PR.
- JS/TS twins (e.g. `factHash.js` ↔ dashboard `factHash.ts`, capability gates) change in lockstep.
- Product is callbacks only (#658): never add speech that promises a live transfer.
- Tests live flat in `tests/`; name them after the module.
