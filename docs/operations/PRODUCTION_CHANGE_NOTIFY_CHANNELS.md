# Production change: notify_channels UPDATE grant

**Status:** APPLIED 2026-08-16  
**Project:** ALCR (`fjxcdccgyhnvnnlnovcl`)  
**Prepared:** 2026-08-15 (Phase 3G)  
**Applied:** 2026-08-16 (Phase 3H A3, human-approved)  
**SQL artifact:** [`../supabase/production_pending/grant_notify_channels_update.sql`](../supabase/production_pending/grant_notify_channels_update.sql)  
**Apply report:** [`PHASE_3H_A3_APPLY_REPORT.md`](./PHASE_3H_A3_APPLY_REPORT.md)

---

## 1. Production state (verified 2026-08-16)

| Check | State | Evidence type |
| --- | --- | --- |
| Column `tenants.notify_channels` exists | **YES** | **FACT** — CLI `20260813210755` |
| `authenticated` UPDATE on `notify_channels` | **YES** | **FACT** — `has_column_privilege` true; CLI `20260816180900` |
| RLS `tenants_update_member` | **YES** | **FACT** — `pg_policies` |
| Wallet `wallet_balance_kes` UPDATE for `authenticated` | **NO** | **FACT** — privilege false after grant |
| Desk save includes `notify_channels` | **YES** | **FACT** — `dashboard/src/app/(desk)/settings/actions.ts` |

---

## 2. Intended state

| Check | Target |
| --- | --- |
| Column exists | Unchanged |
| RLS | Unchanged (`tenants_update_member`) |
| Grant | `GRANT UPDATE (notify_channels) ON public.tenants TO authenticated` |

Matches staging after Phase 3E test fix.

---

## 3. Staging vs production

| Environment | Grant | Notes |
| --- | --- | --- |
| Staging | **Present** | Phase 3E test fix; also in `notify_channels.sql` |
| Production | **Present** | Applied 2026-08-16 |

---

## 4. SQL applied

```sql
grant update (notify_channels) on public.tenants to authenticated;
```

Canonical copy: `docs/supabase/notify_channels.sql` (greenfield/catch-up).  
Production record: CLI `grant_notify_channels_update` / `20260816180900`.

---

## 5. RLS analysis

| Layer | Permits update? |
| --- | --- |
| `tenants_update_member` policy | **YES** — member tenants only (`current_user_tenant_ids()`) |
| Column grant | **YES** (after A3) |
| Wallet trigger | **NO conflict** — `notify_channels` not in protected columns |

**VERDICT:** Owners can persist notify prefs. No policy change was required.

---

## 6. Reversibility

```sql
revoke update (notify_channels) on public.tenants from authenticated;
```

---

## 7. Tests

| Test | Result |
| --- | --- |
| Unit `notifyChannels.test.js` | Covered by `npm run test:mvp` / `test:brain` |
| Privilege check on ALCR | PASS (UPDATE true; wallet UPDATE false) |
| Staging desk save | PASS historically (Phase 3E) |
| Production desk save (A4) | **PENDING** operator smoke |

---

## 8. Production apply procedure (completed)

1. Release gate: SQL-only grant; staging already had the privilege.
2. Human explicitly approved Phase 3H A3.
3. GRANT recorded on ALCR via migration `grant_notify_channels_update`.
4. Ledger `LEDGER-PROD-NOTIFY-GRANT` updated.
5. **A4 still required:** owner save on `https://scalers-project.vercel.app`.

---

## 9. Ledger entry

| Field | Value |
| --- | --- |
| ID | `LEDGER-PROD-NOTIFY-GRANT` |
| What | `GRANT UPDATE (notify_channels)` on `tenants` |
| Why | Desk owner notify preference persistence |
| Where | `production_pending/grant_notify_channels_update.sql` + `notify_channels.sql` |
| Staging applied | YES (2026-08-15) |
| Production applied | **YES** (2026-08-16) |
| Verification | `has_column_privilege` true; CLI `20260816180900` |

---

## Related documents

- [`PHASE_3H_A3_APPLY_REPORT.md`](./PHASE_3H_A3_APPLY_REPORT.md)
- [`../security/PHASE_3F_SECURITY_REVIEW.md`](../security/PHASE_3F_SECURITY_REVIEW.md) (SEC-P1-1)
- [`../storage/STORAGE_SECURITY_MODEL.md`](../storage/STORAGE_SECURITY_MODEL.md)
