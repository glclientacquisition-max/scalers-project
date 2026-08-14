# Branch lifecycle policy

**Status:** Phase 3A governance (2026-08-14)  
**Applies to:** New branches created after this policy. **Does not** rename or bulk-delete existing branches.

---

## Default branch

`main` is the stable, production-capable branch. All PRs target `main` unless explicitly coordinated otherwise.

CI runs on push and pull requests to `main` (see `.github/workflows/ci.yml`).

---

## Standard branch prefixes (new human work)

| Prefix | Purpose | Merge expectation | Example |
| --- | --- | --- | --- |
| `feature/*` | New functionality | Normal PR review + CI | `feature/call-agent-snapshot` |
| `fix/*` | Bug fixes | Normal PR review + CI | `fix/wallet-double-charge` |
| `refactor/*` | Structure only; no intended behavior change | Extra diff scrutiny; full test gates | `refactor/extract-voice-events` |
| `experiment/*` | Spikes, prototypes, may be discarded | May not merge; document learnings | `experiment/openai-realtime-eval` |
| `hotfix/*` | Urgent production issues | Expedited review; still run CI | `hotfix/voice-webhook-500` |

**Naming:** lowercase, kebab-case, descriptive. No `final`, `new2`, `latest-final`.

---

## Cursor cloud agent branches

Cursor agents on this repository use:

```
cursor/<descriptive-name>-d058
```

Examples: `cursor/repo-governance-docs-d058`, `cursor/phase-3a-ci-safety-d058`.

### Forward-looking lifecycle for `cursor/*` branches

1. **Create** — one task per branch; name describes the task.
2. **Work** — stay inside agent lane (`AGENTS.md`).
3. **Open PR** — target `main`; use PR template; CI must pass.
4. **Merge** — squash/merge via GitHub when approved.
5. **After merge** — branch may be deleted **individually** by the author or reviewer after confirming merge. See cleanup below.

### Transition to standard prefixes

New non-Cursor work should prefer `feature/*`, `fix/*`, etc. Existing `cursor/*` branches are **not** renamed.

---

## Historical `cursor/*` branches

**FACT:** The remote has many `cursor/*` branches from rapid agent development.

**Policy:**

- Do **not** bulk-delete remote branches.
- Do **not** rewrite Git history to remove branches.
- Before deleting any single branch, verify: merged to `main` OR explicitly abandoned and documented.
- Stale branch cleanup is a **manual, reviewed** process — not an automated purge.

---

## Branch cleanup (approved process)

When cleaning up a single branch:

1. Confirm PR merged: `gh pr list --state merged --head <branch>` or GitHub UI.
2. Confirm no unique commits: `git log main..origin/<branch>` is empty.
3. Delete remote: `git push origin --delete <branch>` (human approval required).
4. Delete local if present: `git branch -d <branch>`.

For bulk cleanup, produce a list for human review first. Never delete `main`, release tags, or `backup/*` without explicit approval.

---

## Protected expectations

| Rule | Rationale |
| --- | --- |
| No force-push to `main` | Preserve history |
| No merge without CI green | Baseline regression gate |
| One lane per PR | Reduce `server.js` conflict risk |
| Platform first for SQL | Schema contract stability |

---

## Related documents

- [`DEVELOPMENT_WORKFLOW.md`](./DEVELOPMENT_WORKFLOW.md)
- [`../../CONTRIBUTING.md`](../../CONTRIBUTING.md)
- [`../../AGENTS.md`](../../AGENTS.md)
- [`RELEASE_PROCESS.md`](./RELEASE_PROCESS.md)
