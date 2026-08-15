# Feature development contract

**Status:** Canonical lifecycle (Phase 3F, 2026-08-15)  
**Scope:** Every future product feature across all agent lanes

---

## Lifecycle

```
DISCOVER → DESIGN → DATABASE CHANGE → IMPLEMENT → TEST
    → STAGING → VALIDATE → DOCUMENT → RELEASE → OBSERVE → OPTIMIZE
```

Each stage has entry criteria and required artifacts. Do not skip stages without documented waiver.

---

## Stage definitions

### DISCOVER

**Goal:** Confirm the problem, user, and success metric.

| Required | Artifact |
| --- | --- |
| Problem statement | Ticket or lane doc section |
| Lane ownership | Voice / Brain / Desk / Ops / Platform |
| Out of scope | Explicit exclusions |

---

### DESIGN

**Goal:** Specify behavior before code.

| Required | Artifact |
| --- | --- |
| Product behavior spec | What user sees and what system does |
| API / RPC contract | If backend surface changes |
| RLS / tenant model | If data crosses tenants |
| Dependencies | Other features, external providers |

---

### DATABASE CHANGE

**Goal:** Land schema intent in Git before or with implementation.

| Required | Artifact |
| --- | --- |
| SQL script | `docs/supabase/<feature>.sql` with `-- Run after:` |
| README tier entry | `docs/supabase/README.md` |
| Apply order | `docs/database/DATABASE_APPLY_ORDER.md` if new dependency |
| Ledger row | `docs/supabase/MIGRATION_LEDGER.md` (draft → complete after staging) |
| Platform review | Required for `src/db.js` contract changes |

**Skip if:** Feature is code-only with no schema impact (document "N/A" in PR).

---

### IMPLEMENT

**Goal:** Working code on feature branch.

| Lane | Typical paths |
| --- | --- |
| Voice | `server.js`, `src/voice*`, `src/db.js` |
| Brain | `src/brain*`, prompts, tools |
| Desk | `dashboard/src/**` |
| Ops | Wallet/DID admin, billing |
| Platform | `src/db.js`, SQL, auth contracts |

**Rules:**

- Stay inside lane **owns** paths (`AGENTS.md`).
- No parallel heavy `server.js` edits across agents.
- Match existing naming and patterns.

---

### TEST

**Goal:** Prove correctness before staging.

| Required | Minimum |
| --- | --- |
| Unit tests | New logic in `tests/` where conventions exist |
| `npm run test:voice` | If voice touched |
| `npm run test:mvp` | If brain/tools/notify touched |
| Desk lint + build | If desk touched |

---

### STAGING

**Goal:** Validate against real Supabase (non-production).

| Required | Action |
| --- | --- |
| Apply SQL | Staging project `sgcdncjxauhsbunobmob` only |
| Configure env | Staging credentials per `ENVIRONMENT_CONTRACT.md` |
| `npm run smoke:db` | If DB or `src/db.js` touched |
| Signup smoke | If auth trigger / onboarding touched |

---

### VALIDATE

**Goal:** Confirm feature works end-to-end.

| Required | Evidence |
| --- | --- |
| Happy path | Screenshot, video, or log |
| Edge cases | Document tested cases |
| Desk E2E | If UI feature |
| Live call | If voice behavior |

---

### DOCUMENT

**Goal:** Preserve knowledge for next engineer.

| Required | Location |
| --- | --- |
| Lane doc update | `docs/agents/<LANE>.md` if contract changes |
| Product doc | If user-facing behavior |
| Ledger completion | Staging apply date + verification |
| CHANGELOG | User-visible changes |

---

### RELEASE

**Goal:** Ship via release gate.

| Required | Reference |
| --- | --- |
| All release gates | [`RELEASE_GATE.md`](../operations/RELEASE_GATE.md) |
| Production SQL approval | Human explicit |
| Ledger production row | After apply |

---

### OBSERVE

**Goal:** Confirm production health post-deploy.

| Action | When |
| --- | --- |
| Health check | Immediately after deploy |
| Error logs | First 24h for risky changes |
| Customer impact | Wallet/voice critical paths |

---

### OPTIMIZE

**Goal:** Iterate based on data (later cycle).

Not required before merge. Track debt in `TECHNICAL_DEBT.md` if deferred.

---

## Example: Appointment reminders

| Stage | Must contain |
| --- | --- |
| DISCOVER | Owner needs SMS before confirmed visits |
| DESIGN | Trigger rules, quiet hours, channel prefs (`notify_channels`) |
| DATABASE CHANGE | Only if new columns/RPCs; else document N/A |
| IMPLEMENT | Brain notify tool + TextSMS integration + desk prefs UI |
| TEST | `test:notify`, `test:mvp`, appointment unit tests |
| STAGING | Staging SQL if any; smoke send to test number |
| VALIDATE | Video of reminder firing on staging appointment |
| DOCUMENT | Brain lane doc, ledger if SQL |
| RELEASE | Release gate 1–12 |
| OBSERVE | Delivery logs, opt-out rate |
| OPTIMIZE | Timing tuning (future) |

---

## Merge requirements (summary)

Before PR merge to `main`:

- [ ] Behavior spec linked in PR description
- [ ] SQL + README + ledger if schema changed
- [ ] Tests pass locally
- [ ] No production credentials in diff
- [ ] Lane ownership respected
- [ ] Staging validation completed OR documented waiver with follow-up ticket

Before production:

- [ ] [`RELEASE_GATE.md`](../operations/RELEASE_GATE.md) complete
- [ ] Ledger production fields updated

---

## Related documents

- [`DATABASE_EVOLUTION.md`](../database/DATABASE_EVOLUTION.md)
- [`RELEASE_GATE.md`](../operations/RELEASE_GATE.md)
- [`ENVIRONMENT_CONTRACT.md`](../operations/ENVIRONMENT_CONTRACT.md)
- [`../AGENTS.md`](../../AGENTS.md) (lane table)
