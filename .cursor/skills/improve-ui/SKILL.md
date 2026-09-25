---
name: improve-ui
description: Audit one desk or landing surface against Scalers constitution and MASTER. Read-only unless the user asks to implement. Use to review, refine, or hand off UI without replacing product identity.
---

# Improve UI (Scalers)

Source: [ibelick/ui-skills](https://github.com/ibelick/ui-skills) `improve-ui` (MIT). Proof gate kept. `design-plans/` dropped. Governing sources are local.

## Boundaries

Default is read-only on product source. Do not install deps, format the tree, commit, or invent a `DESIGN.md`.

If the user asks to implement a selected finding, stay in Desk paths and keep the constitution.

Plans the user wants written go under `docs/specs/`, not `design-plans/`.

## 1. Select the surface

One deployable app, one coherent task. Owner desk is `(desk)` routes. Marketing is landing. Do not merge `/admin` into the owner shell.

Trace the rendered path: route, layout, primitives, tokens. Shared names alone are not a connection.

## 2. Reconstruct the local system

Governing sources, in order:

1. `.cursor/rules/scalers-design-ux.mdc`
2. `docs/frontend/FRONTEND_CONSTITUTION.md`
3. `docs/frontend/design-system/MASTER.md` and the page file under `docs/frontend/design-system/pages/`
4. Live tokens in `dashboard/src/app/globals.css`

Drafts and task lists are not law unless accepted.

```markdown
## Design language
- Audited surface:
- Design sources:
- Documented decisions:
- Governing owners:
- Explicit exceptions:
```

Write `None documented` under exceptions unless a cited source names one.

## 3. Prove findings

A finding needs all three:

1. **Contract.** A binding rule for this property, or a direct contradiction in user-facing copy or chrome on the same task.
2. **Runtime.** The cited owner actually reaches the surface.
3. **Correction.** One change. Name the existing token or primitive. If you would invent product intent, drop it.

Keep visual presentation, interface copy, layout, and documented design-rule drift. Discard broken data wiring unless the user asked for it or a design contract governs it.

Accessibility: send those to `/fixing-accessibility` unless the user asked here.

Stop at three findings. Prefer no finding to an unsupported one.

## 4. Report

```markdown
## Findings
| # | Problem | Evidence | Proposed change | Scope | Confidence |
| --- | --- | --- | --- | --- | --- |

## Improve first
<one finding, or no supported recommendation>
```

Then ask which to implement. Do not silently restyle the product.
