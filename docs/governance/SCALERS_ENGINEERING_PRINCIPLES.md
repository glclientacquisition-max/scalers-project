# Scalers engineering principles

**Status:** Permanent governance (2026-08-14)  
**Audience:** Human engineers, Cursor, Claude, and all future AI agents working on Scalers.

These principles apply to every change. Lane-specific rules in `AGENTS.md` and `docs/agents/*.md` add detail but do not override these fundamentals.

---

## 1. Preserve working behavior

Organization must not come at the cost of a working beta product. If a task requires behavior change, split it:

- **Task A:** Repository / documentation / governance
- **Task B:** Behavioral refactor (separate PR, explicit approval)

When in doubt, document first. Do not "clean up" code that is actively serving production calls.

---

## 2. Evidence before deletion

Do not delete files, migrations, branches, or code paths because they look old.

Classify first: CORE, ACTIVE, LEGACY, EXPERIMENTAL, DUPLICATE, DEPRECATED, UNKNOWN.

Removal requires evidence that nothing imports, deploys, or references the artifact.

---

## 3. Small, reversible changes

Prefer focused PRs over giant rewrites. One lane, one concern, one PR where possible.

`server.js` and `TenantForm.tsx` are high-risk surfaces — extract modules only with tests and explicit approval.

Every change should have a clear rollback: `git revert` or redeploy previous image.

---

## 4. Production stability over cleverness

Latency, barge-in, billing correctness, and tenant isolation outweigh elegant abstractions.

Do not introduce frameworks, workspaces, or shared packages during governance phases without a dedicated architecture project.

---

## 5. No secrets in Git

- Never commit `.env`, API keys, service role keys, or tokens.
- Never put `SUPABASE_SERVICE_ROLE_KEY` in `NEXT_PUBLIC_*`.
- Document variables in `.env.example` with empty placeholders only.
- If a secret was committed: treat as **SECURITY INCIDENT** — rotate credentials; do not assume deletion is sufficient.

---

## 6. Migrations must be traceable

SQL changes live in `docs/supabase/` with documented apply order.

Do not edit scripts that may already be applied in production without a new additive script and header noting predecessors.

Supabase CLI migration adoption is a **future project** requiring live DB audit first.

---

## 7. AI behavior must become versionable

Today: agent configuration is loaded per call but not snapshotted on the call record.

Target: every production call traceable to prompt version, model, voice, tool schema, and platform SHA.

Do not block current work on this — but do not make it harder (e.g., by adding more undeclared prompt paths).

See: [`../agents/PROMPT_VERSIONING.md`](../agents/PROMPT_VERSIONING.md).

---

## 8. Customer configuration ≠ platform code

| Platform code | Business configuration |
| --- | --- |
| `server.js`, `src/`, `dashboard/src/` logic | `tenants.*` columns |
| Turn-taking, STT/TTS wiring | `llm_system_prompt`, catalog, FAQs |
| Wallet RPCs (Platform implements) | Rates, enforcement mode (Ops specifies) |

Beachhead test fixtures (ChapterOne) belong in tests — not hardcoded in voice runtime.

---

## 9. Document important architectural decisions

New significant decisions → `docs/adr/ADR-XXXX-title.md`.

Reconstructed historical decisions must be labeled **Reconstructed historical decision**.

Do not fabricate ADRs for decisions you cannot support with evidence.

---

## 10. AI agents must inspect before modifying

Before editing code:

1. Read `AGENTS.md` and the relevant lane contract.
2. Read [`../architecture/CURRENT_STATE.md`](../architecture/CURRENT_STATE.md) and [`SOURCE_OF_TRUTH.md`](./SOURCE_OF_TRUTH.md).
3. Identify affected subsystem and source of truth.
4. Check `git status` and current branch.
5. Formulate a plan for non-trivial changes.

See extended safety protocol in `AGENTS.md`.

---

## 11. Tests must not be weakened to hide failures

- Do not delete failing tests to make CI green.
- Do not weaken assertions without documented intentional behavior change.
- Distinguish **pre-existing failure** from **regression introduced by this change**.
- Pre-existing baseline: dashboard lint failure (`retailOnboardingPack.ts`) — fix in dedicated PR, not silently ignored.

Required gates by lane:

| Lane | Gate |
| --- | --- |
| Voice | `npm run test:voice` |
| Brain | `npm run test:brain` / `npm run test:mvp` |
| Desk | `cd dashboard && npm run build` |
| Platform | SQL review + smoke when env available |

---

## 12. Observable and explainable production behavior

Prefer structured logs without PII. Today brain traces go to stdout only.

Every production behavior should eventually be explainable: what code, what config, what tenant state.

---

## Related documents

- [`DEVELOPMENT_WORKFLOW.md`](./DEVELOPMENT_WORKFLOW.md)
- [`TECHNICAL_DEBT.md`](./TECHNICAL_DEBT.md)
- [`../agents/PROMPT_VERSIONING.md`](../agents/PROMPT_VERSIONING.md)
- [`../../AGENTS.md`](../../AGENTS.md)
