# Agent skills (Matt Pocock, composed)

These skills sit **beside** Scalers lanes. They do not replace `AGENTS.md`.

Install is a subset of [mattpocock/skills](https://github.com/mattpocock/skills): grill, wayfinder, TDD, code-review, plus the model-invoked helpers they call (grilling, domain-modeling, writing-for-agents, setup).

## Use with lanes

1. Read `AGENTS.md` and the lane contract first.
2. Read `CONTEXT.md` for names. Do not invent synonyms the glossary forbids.
3. Grill (`grill-with-docs`) before non-trivial Brain or Platform work.
4. TDD against the lane gate (`npm run test:brain`, `npm run test:mvp`, …).
5. Wayfinder maps and specs live as markdown under `docs/specs/` (Cloud Agents cannot create GitHub issues).
6. Code-review is two-axis: standards vs spec. Do not merge the axes.

Do not install GSD / BMAD / Spec-Kit as a second operating system. Do not copy the rest of the upstream skill set unless a later ticket asks for it.
