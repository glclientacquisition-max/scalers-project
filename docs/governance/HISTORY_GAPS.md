# History gaps

**Status:** Governance baseline (2026-08-14)  
**Purpose:** Record what **cannot** be confidently reconstructed from this repository alone.

Do not fill gaps with guesses. Mark items **UNKNOWN** until verified by a human with production access.

---

## Pre-July 2026 work

| Gap | What we know | What we do not know |
| --- | --- | --- |
| Earlier prototypes | One commit in July 2026 (`293a281`) | Whether work existed in other repos, branches, or local-only checkouts |
| Original product name | Repo named `missed-call-agent`; GitHub `scalers-project` | When branding unified to Scalers |
| First telephony provider | Blueprint documents Twilio → SautiKit migration | Exact dates of first live SautiKit call |

**Do not assume** pre-July history is lost — it may simply live outside this repo.

---

## Live Supabase migration state

| Gap | Evidence of problem | Impact |
| --- | --- | --- |
| Which of 31 SQL scripts are applied on production | No `schema_migrations` table in repo; manual apply model | Cannot reproduce prod schema from Git alone |
| Whether dev/staging/prod share one Supabase project | No staging config in repo | Risk of testing against production data |
| Column-era of production `tenants` table | `src/db.js` has progressive SELECT fallbacks for missing columns | **INFERENCE:** some environments may lag on SQL tier |

**Required verification:** Human with Supabase dashboard access should compare live schema to `docs/supabase/README.md` tier list.

---

## Production deployment state

| Gap | Notes |
| --- | --- |
| Live Railway voice health | URL referenced in code; not verified in audit |
| Live Vercel desk health | URL referenced in `layout.tsx`; not verified |
| SautiKit webhook configuration per DID | External to repo |
| Beta tenant count and `billing_enforcement` distribution | Not in repo |

---

## Git branches and tags

| Artifact | Gap |
| --- | --- |
| `backup/2026-08-13` tag | Purpose and whether it should be preserved long-term — **UNKNOWN** |
| `backup/history-2026-08-13` remote branch | Relationship to tag — **UNKNOWN** |
| 143 `cursor/*` remote branches | Which are merged, abandoned, or still active — **UNKNOWN** without per-branch review |

**Policy:** Do not bulk-delete branches without explicit human approval and merge verification.

---

## Architectural decision reasoning

| Decision | What is documented | What is missing |
| --- | --- | --- |
| SautiKit over Twilio | Blueprint rationale (cost, Kenya DIDs, PCM) | Formal ADR at time of decision — reconstructed in ADR-0001 |
| Manual SQL vs migrations CLI | README apply order | Why CLI was not adopted — **UNKNOWN** |
| Legacy Super Admin cookie | `SUPER_ADMIN_REQUIREMENTS.md` | Planned migration date — **UNKNOWN** |
| JS + TS duplication | Desk mirror comments | Whether shared package was deferred intentionally — **UNKNOWN** |

---

## Agent versioning

| Gap | Notes |
| --- | --- |
| Historical call agent config | No snapshot on `calls` — cannot reconstruct past agent behavior from DB |
| Prompt changes over time | Only current `llm_system_prompt` on tenant; no version history table |
| Model changes in production | Env-based; not logged per call |

See: [`../agents/PROMPT_VERSIONING.md`](../agents/PROMPT_VERSIONING.md).

---

## External systems

| System | Gap |
| --- | --- |
| Soniox/Gemini production SLOs | Not in repo |
| M-Pesa / Paystack top-up | Env stubs only; integration status **UNKNOWN** |
| CI/CD outside GitHub Actions | No `.github/` in repo; external CI **UNKNOWN** |

---

## How to close gaps (future work, not Phase 2)

1. **Production SQL audit** — document applied script tier in `DATABASE_GOVERNANCE.md` addendum
2. **Staging environment** — define and document in `ENVIRONMENTS.md`
3. **Agent snapshot project** — see `PROMPT_VERSIONING.md`
4. **Branch hygiene** — merge verification + labeled cleanup policy
5. **ADR process** — new decisions via `docs/adr/` going forward

---

## Related documents

- [`PROJECT_HISTORY.md`](./PROJECT_HISTORY.md)
- [`../database/DATABASE_GOVERNANCE.md`](../database/DATABASE_GOVERNANCE.md)
- [`../operations/ENVIRONMENTS.md`](../operations/ENVIRONMENTS.md)
