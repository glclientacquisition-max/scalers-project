# Agent skills

These skills sit beside Scalers lanes. They do not replace `AGENTS.md` or Desk constitution.

Matt Pocock set: grill, wayfinder, TDD, code-review, plus grilling, domain-modeling, writing-for-agents, setup.

Desk motion: **desk-motion** (pending / live / land / shift / press). Wins over any catalog motion pack.

Imported and adapted (2026-09):

| Skill | From | Job |
| --- | --- | --- |
| `/reticle` | [reticlehq/reticle](https://github.com/reticlehq/reticle) | Prove a UI change in the running app. No SDK install. |
| `/chisle` | [JayPokale/Chisle](https://github.com/JayPokale/Chisle) | Terse replies, YAGNI diffs. `/chisle-audit` is read-only. |
| `/ui-skills` | [ibelick/ui-skills](https://github.com/ibelick/ui-skills) | Route to `/baseline-ui`, `/improve-ui`, `/fixing-accessibility`. |
| `/no-ai-slop` | [petergyang/no-ai-slop](https://github.com/petergyang/no-ai-slop) + [unslop](https://github.com/cursor/plugins/blob/main/pstack/skills/unslop/SKILL.md) | Stark desk copy and drafts. |

## Use with lanes

1. Read `AGENTS.md` and the lane contract first.
2. Read `CONTEXT.md` for names. Do not invent synonyms the glossary forbids.
3. Grill (`grill-with-docs`) before non-trivial Brain or Platform work.
4. TDD against the lane gate (`npm run test:brain`, `npm run test:mvp`, …).
5. Wayfinder maps and specs live as markdown under `docs/specs/`.
6. Code-review is two-axis: standards vs spec. Do not merge the axes.
7. After desk UI work: `/ui-skills` then `/reticle`. Copy: `/no-ai-slop`.

## Left upstream (fights law or needs a new MCP)

- `ckanthony/Chisel` filesystem MCP (Cursor already has Read / Grep / StrReplace).
- Reticle `init`, license keys, `present: true` HUD, SDK embed in `dashboard/`.
- ibelick remote taste packs (impeccable, Anthropic frontend-design, shadcn, GSAP).
- `create-design-md` (MASTER already exists).
- `Euraika-Labs/ai-slopcheck` (Python scanner, no skill).
- `yetone/kill-ai-slop` wholesale (would restyle brand tokens). Visual tells that match constitution live in `/baseline-ui` and `/no-ai-slop`.

Do not install GSD / BMAD / Spec-Kit as a second operating system.
