# dashboard/ — Desk and Super Admin (Next.js on Vercel)

Rules for code under `dashboard/`. Root rules in [`../AGENTS.md`](../AGENTS.md) still apply.

## Lanes

| Path | Lane | Contract |
| --- | --- | --- |
| `src/app/(desk)/**`, `src/components/**`, `src/app/onboarding/**` | Desk UI/UX | [`docs/reference/lanes/DESK_UX.md`](../docs/reference/lanes/DESK_UX.md) |
| `src/app/admin/**`, packages, wallet, DID pool | Ops & Billing | [`docs/reference/lanes/OPS_BILLING.md`](../docs/reference/lanes/OPS_BILLING.md) |
| `src/lib/supabase*`, auth, `src/app/api/**` contracts | Platform | [`docs/reference/lanes/PLATFORM.md`](../docs/reference/lanes/PLATFORM.md) |

## Commands

- `npm ci && npm run lint && npm run build` (Node 22). E2E: `npm run test:e2e`.
- Root `npm run test:mvp` also covers many Desk source checks in `../tests/`.

## Rules

- Design canon: [`docs/explanation/frontend/FRONTEND_2_0_CHARTER.md`](../docs/explanation/frontend/FRONTEND_2_0_CHARTER.md) wins, then [`docs/reference/design-system/MASTER.md`](../docs/reference/design-system/MASTER.md) and its `pages/`.
- Never put `SUPABASE_SERVICE_ROLE_KEY` or any secret in `NEXT_PUBLIC_*`.
- Owner copy never mentions unbuilt features (no live transfer: callbacks only, #658).
- Only `main` auto-deploys to Vercel (#665); staging gets one debounced API deploy.
