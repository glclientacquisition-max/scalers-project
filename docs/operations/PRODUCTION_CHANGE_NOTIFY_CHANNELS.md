# Production change: notify_channels UPDATE grant

**Status:** PREPARED — NOT APPLIED  
**Project:** ALCR (`fjxcdccgyhnvnnlnovcl`)  
**Prepared:** 2026-08-15 (Phase 3G)  
**SQL artifact:** [`../supabase/production_pending/grant_notify_channels_update.sql`](../supabase/production_pending/grant_notify_channels_update.sql)

---

## 1. Current production state (evidence)

| Check | State | Evidence type |
| --- | --- | --- |
| Column `tenants.notify_channels` exists | **YES** | **FACT** — CLI migration `20260813210755`; `foundation_bootstrap.sql` |
| `authenticated` UPDATE on `notify_channels` | **NO** | **FACT** — `foundation_bootstrap.sql` §6 comment (verified 2026-08-14) |
| RLS `tenants_update_member` | **YES** | **FACT** — `owner_rls.sql` / bootstrap §5 |
| Desk save includes `notify_channels` | **YES** | **FACT** — `dashboard/src/app/(desk)/settings/actions.ts` |

**INFERENCE:** Owners can SELECT `notify_channels` but Postgres rejects UPDATE without column privilege.

---

## 2. Intended state

| Check | Target |
| --- | --- |
| Column exists | Unchanged |
| RLS | Unchanged (`tenants_update_member`) |
| Grant | `GRANT UPDATE (notify_channels) ON public.tenants TO authenticated` |

Matches staging after Phase 3E test fix (**FACT:** staging `has_column_privilege` = true).

---

## 3. Staging vs production

| Environment | Grant | Notes |
| --- | --- | --- |
| Staging | **Present** | Phase 3E test fix — represents intended behavior |
| Production | **Absent** | Documented gap |

---

## 4. SQL to apply (production — pending approval)

```sql
grant update (notify_channels) on public.tenants to authenticated;
```

Full file: `docs/supabase/production_pending/grant_notify_channels_update.sql`

---

## 5. RLS analysis

| Layer | Permits update? |
| --- | --- |
| `tenants_update_member` policy | **YES** — member tenants only (`current_user_tenant_ids()`) |
| Column grant | **NO today** — blocker |
| Wallet trigger | **NO conflict** — `notify_channels` not in protected columns |

**VERDICT:** RLS permits the operation once column grant is added. No policy change required.

---

## 6. Reversibility

```sql
revoke update (notify_channels) on public.tenants from authenticated;
```

---

## 7. Tests before production apply

| Test | Command / action |
| --- | --- |
| Unit | `npm run test:mvp` (includes `notifyChannels.test.js`) |
| Staging desk save | Owner JWT → save notify prefs → reload settings |
| Regression | Wallet columns still RPC-only |
| smoke:db | `npm run smoke:db` on staging |

---

## 8. Production apply procedure

1. Complete [`RELEASE_GATE.md`](./RELEASE_GATE.md).
2. Human explicitly approves this change.
3. Run SQL in Supabase SQL Editor (ALCR) — **operator only**.
4. Update `MIGRATION_LEDGER.md`: `LEDGER-PROD-NOTIFY-GRANT`, production_applied = YES, date, verifier.
5. Desk smoke: save notify channel toggles on one production tenant.

---

## 9. Ledger entry (draft)

| Field | Value |
| --- | --- |
| ID | `LEDGER-PROD-NOTIFY-GRANT` |
| What | `GRANT UPDATE (notify_channels)` on `tenants` |
| Why | Desk owner notify preference persistence |
| Where | `production_pending/grant_notify_channels_update.sql` |
| Staging applied | YES (2026-08-15) |
| Production applied | **NO** (pending) |
| Verification | Staging desk path; unit tests |

---

## Related documents

- [`../security/PHASE_3F_SECURITY_REVIEW.md`](../security/PHASE_3F_SECURITY_REVIEW.md) (SEC-P1-1)
- [`../storage/STORAGE_SECURITY_MODEL.md`](../storage/STORAGE_SECURITY_MODEL.md)
