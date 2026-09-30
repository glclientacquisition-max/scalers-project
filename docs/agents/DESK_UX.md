# Desk UI/UX lane contract

**Mission:** Make every Scalers screen, owner desk and Super Admin alike, feel as obvious and fast as WhatsApp or Instagram, without breaking Auth / RLS or admin isolation.

**Frontend 2.0 program (2026-09-30):** [`docs/frontend/FRONTEND_2_0_CHARTER.md`](../frontend/FRONTEND_2_0_CHARTER.md) is the law. It supersedes the phase table in `FRONTEND_CONSTITUTION.md` and the recon gate. Older docs stay for history: [`FRONTEND_CONSTITUTION.md`](../frontend/FRONTEND_CONSTITUTION.md), [`design-system/MASTER.md`](../frontend/design-system/MASTER.md), [`FRONTEND_RECONNAISSANCE.md`](../frontend/FRONTEND_RECONNAISSANCE.md). Where they conflict with the charter, the charter wins.

Use for landing, signup/onboarding UX, calls inbox, settings presentation, navigation, admin presentation, and visual design. Not for wallet ledger rules, RPC behavior, or voice audio.

## Owns (edit freely)

| Path | Role |
| --- | --- |
| `dashboard/src/app/page.tsx`, `layout.tsx`, `globals.css` | App shell + tokens |
| `dashboard/src/app/login/**`, `signup/**`, `onboarding/**` | Auth / activation UX (UI + light action wiring) |
| `dashboard/src/app/(desk)/**` | Owner desk pages/layouts/nav |
| `dashboard/src/components/**` | Shared UI, including the presentation layer of `Admin*`, `DidPool*`, `BuyNumber*`, `Sautikit*` panels* |
| `dashboard/src/app/admin/**` layouts and page composition | Super Admin shell and screens (presentation) |
| `dashboard/src/components/marketing/**`, `brand/**` | Landing + brand |
| `dashboard/src/components/ui/**`, `shell/**` | Primitives and `AppShell` |
| `dashboard/e2e/**` | Playwright visual and axe gate |
| `dashboard/README.md` | Desk local/dev notes that are UX-facing |

\* Frontend 2.0 owns how admin panels look and lay out. **Ops** still owns what they do: RPC calls, wallet math, DID assignment, package rules. Do not change a server action's inputs or outputs from this lane.

## Do not touch

- `server.js`, `src/speech/**`, `src/sautikit/**` (Voice)
- Prompt compiler semantics / conversation policy (Brain) — Desk may rearrange settings UI but not redefine compile rules
- `docs/supabase/**`, wallet RPCs, DID assignment logic (Platform / Ops)
- Cross-contaminating owner desk nav with Super Admin nav

## Product UX invariants

1. **Strict shell split:** owners → `(desk)` with `DESK_LINKS`; ops → `/admin/*` with `ADMIN_LINKS`. Both render through one `AppShell` (tabs below `md`, rail on `md+`). Never merge the two link lists or their sessions.
2. Brand-first marketing: Scalers must read as the hero identity on the landing first viewport.
3. **Frontend 2.0 mandate (always on):** Follow `.cursor/rules/scalers-design-ux.mdc` and the charter on every UI change. Build from the kit in `components/ui/`. Tokens only, no hex. `ListRow` for lists, `Segmented` for filters, `IconButton` for row actions, docked Save, shaped skeletons, `Empty` with a next action.
4. **Motion:** Follow `.cursor/skills/desk-motion/SKILL.md` and `emil-design-eng`. Only pending, live, land, shift, press. Notices use `DeskNotice`. No Lottie or Framer Motion on desk.
5. Phone and desktop share one composition. Split panes from `lg`. Controls do not change size by label length.
6. **Proof:** the Playwright gate in `dashboard/e2e` at 360, 390, 768, 1280, light and dark, before a PR is ready.
7. Auth: owner sessions use Supabase SSR + RLS; never expose `SUPABASE_SERVICE_ROLE_KEY` to the browser.
8. Onboarding redirect for blank/default prompts stays intact unless Platform/Brain agree to change the gate.

## Test / verify

```bash
cd dashboard && npm run lint
cd dashboard && npm run build
```

Spot-check: `/`, `/signup`, `/onboarding`, `/calls`, `/settings` as owner; confirm `/admin` still redirects owners away.

## Chat starter

```
You are the Scalers Frontend 2.0 agent (Desk UI/UX lane).
Read docs/frontend/FRONTEND_2_0_CHARTER.md, docs/agents/DESK_UX.md, and .cursor/rules/scalers-design-ux.mdc.
Skills: frontend-design before a new surface, redesign-existing-projects to audit, emil-design-eng for motion, accessibility before ready.
Build from the kit in dashboard/src/components/ui. Tokens only. One AppShell.
Preserve owner vs Super Admin sessions and Auth/RLS boundaries. Presentation only on admin panels.
Do not change voice engine, wallet ledger rules, RPC contracts, or prompt policy semantics.
Run dashboard lint, build, and the Playwright gate before finishing.
Task: <one charter phase or one surface inside a phase>
```

## Good first tickets

- Calls inbox triage clarity (status, empty states, mobile)
- Settings information architecture without adding card clutter
- Onboarding wizard activation polish
- Landing first-viewport brand strength
- Consistent design tokens in `globals.css`
