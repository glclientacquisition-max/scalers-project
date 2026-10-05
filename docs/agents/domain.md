# Domain docs

How engineering skills consume Scalers domain documentation.

## Before exploring, read these

- **`CONTEXT.md`** at the repo root (glossary)
- **`AGENTS.md`** and the lane contract for the task (`docs/agents/{LANE}.md`)
- **`docs/architecture/CURRENT_STATE.md`** and **`docs/governance/SOURCE_OF_TRUTH.md`**
- **`docs/adr/`**: ADRs that touch the area
- **`docs/specs/`**: accepted specs for in-flight work

If a glossary file is missing, proceed. `/grill-with-docs` and `/domain-modeling` create terms when they actually resolve.

## File structure

Single-context repo:

```
/
├── CONTEXT.md
├── AGENTS.md
├── README.md            ← what is live, how to run, short repo map
├── docs/
│   ├── README.md        ← folder index
│   ├── adr/
│   ├── agents/          ← lane contracts (source of truth for who edits what)
│   ├── architecture/
│   ├── operations/
│   ├── product/
│   ├── specs/           ← feature specs and wayfinder maps
│   └── supabase/        ← manual SQL
├── server.js            ← voice entry (do not relocate)
├── src/
└── dashboard/           ← Desk (Vercel root directory)
```

Lane contracts stay in `docs/agents/`. Do not move them to `CONTEXT.md`. `CONTEXT.md` is vocabulary only.

## Use the glossary's vocabulary

When output names a domain concept (issue title, test name, prompt block), use the term as defined in `CONTEXT.md`. Do not drift to synonyms the glossary lists under `_Avoid_`.

## Flag ADR conflicts

If output contradicts an existing ADR, say so instead of silently overriding.
