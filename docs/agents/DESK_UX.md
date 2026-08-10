# Desk UI/UX lane contract

**Mission:** Make Scalers’ owner desk and marketing feel clear, branded, and fast — without breaking Auth / RLS or admin isolation.

Use for landing, signup/onboarding UX, calls inbox, settings presentation, navigation, and visual design. Not for wallet ledger rules or voice audio.

## Owns (edit freely)

| Path | Role |
| --- | --- |
| `dashboard/src/app/page.tsx`, `layout.tsx`, `globals.css` | App shell + tokens |
| `dashboard/src/app/login/**`, `signup/**`, `onboarding/**` | Auth / activation UX (UI + light action wiring) |
| `dashboard/src/app/(desk)/**` | Owner desk pages/layouts/nav |
| `dashboard/src/components/**` except admin/wallet/DID telecom panels* | Shared UI |
| `dashboard/src/components/marketing/**`, `brand/**` | Landing + brand |
| `dashboard/src/components/ui/**` | Primitives |
| `dashboard/README.md` | Desk local/dev notes that are UX-facing |

\* Prefer leaving `Admin*`, `DidPool*`, `BuyNumber*`, `Sautikit*`, `AdminWallets*` to **Ops** unless the change is pure styling with no behavior change.

## Do not touch

- `server.js`, `src/speech/**`, `src/sautikit/**` (Voice)
- Prompt compiler semantics / conversation policy (Brain) — Desk may rearrange settings UI but not redefine compile rules
- `docs/supabase/**`, wallet RPCs, DID assignment logic (Platform / Ops)
- Cross-contaminating owner desk nav with Super Admin nav

## Product UX invariants

1. **Strict shell split:** owners → `(desk)` (Calls / Settings / Wallet); ops → `/admin/*`. Never merge navs.
2. Brand-first marketing: Scalers must read as the hero identity on the landing first viewport.
3. Follow repo frontend design rules (one composition, no hero cards/overlays, expressive type, atmospheric background — avoid purple-on-white / cream-serif-terracotta clichés).
4. Mobile + desktop both load cleanly.
5. Auth: owner sessions use Supabase SSR + RLS; never expose `SUPABASE_SERVICE_ROLE_KEY` to the browser.
6. Onboarding redirect for blank/default prompts stays intact unless Platform/Brain agree to change the gate.

## Test / verify

```bash
cd dashboard && npm run lint
cd dashboard && npm run build
```

Spot-check: `/`, `/signup`, `/onboarding`, `/calls`, `/settings` as owner; confirm `/admin` still redirects owners away.

## Chat starter

```
You are the Scalers Desk UI/UX lane agent.
Follow docs/agents/DESK_UX.md and .cursor/rules/desk-ux.mdc.
Only change dashboard owner/marketing UX.
Preserve owner vs Super Admin shell split and Auth/RLS boundaries.
Do not change voice engine, wallet ledger rules, or prompt policy semantics.
Run dashboard lint/build before finishing.
Task: <one concrete UI/UX improvement>
```

## Good first tickets

- Calls inbox triage clarity (status, empty states, mobile)
- Settings information architecture without adding card clutter
- Onboarding wizard activation polish
- Landing first-viewport brand strength
- Consistent design tokens in `globals.css`
