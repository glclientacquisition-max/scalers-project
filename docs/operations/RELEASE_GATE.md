# Release gate

**Status:** Canonical checklist (Phase 3F, 2026-08-15)  
**Applies to:** Every production feature deployment (code and/or database)

No release proceeds to production until all **required** gates pass or an explicit human waiver is recorded.

---

## Gate overview

```
Code merge candidate
       │
       ▼
┌──────────────────┐
│ 1. Code tests    │
│ 2. DB on staging │
│ 3. smoke:db      │
│ 4. Voice tests   │
│ 5. MVP tests     │
│ 6. Desk lint     │
│ 7. Desk build    │
│ 8. Feature tests │
│ 9. Ledger update │
│10. SQL review    │
│11. Rollout plan  │
│12. Prod approval │
└──────────────────┘
       │
       ▼
 Production deploy
```

---

## Checklist

### 1. Code tests pass

| Check | Command | Required |
| --- | --- | --- |
| Voice unit suite | `npm run test:voice` | **YES** |
| Affected unit tests | `node --test tests/<relevant>.test.js` | **YES** if touched |

**Evidence:** CI log or local terminal output attached to PR.

---

### 2. Database rebuild / migration passes on staging

| Scenario | Action | Required |
| --- | --- | --- |
| New SQL script | Apply to **staging only** (`sgcdncjxauhsbunobmob`) | **YES** |
| No SQL change | Confirm staging already at required tier | **YES** if feature depends on schema |
| Full rebuild | Follow [`DATABASE_APPLY_ORDER.md`](../database/DATABASE_APPLY_ORDER.md) | For major platform changes |

**Blocker:** Never validate schema changes on production first.

---

### 3. DB smoke passes

| Check | Command | Required |
| --- | --- | --- |
| Application DB path | `npm run smoke:db` | **YES** for DB or `src/db.js` changes |
| Credentials | Staging `SUPABASE_URL` + service_role | **YES** |

Validates: tenant upsert, call/transcript, wallet RPC, storage upload, recording attach.

---

### 4. Voice tests pass

Covered by gate 1 (`npm run test:voice`). Required for any `server.js`, voice lane, or STT/TTS change.

---

### 5. MVP tests pass

| Check | Command | Required |
| --- | --- | --- |
| Brain + smoke scripts | `npm run test:mvp` | **YES** for brain, tools, notify, playbook changes |

---

### 6. Dashboard lint passes

| Check | Command | Required |
| --- | --- | --- |
| ESLint | `cd dashboard && npm run lint` | **YES** for desk changes |
| Warnings | Document pre-existing warnings | Allowed if not introduced by PR |

---

### 7. Dashboard build passes

| Check | Command | Required |
| --- | --- | --- |
| Production build | `cd dashboard && npm run build` | **YES** for desk changes |

---

### 8. Feature-specific tests pass

| Lane | Examples | Required when |
| --- | --- | --- |
| Brain | `npm run test:brain` | Prompt/tool changes |
| Notify | `npm run test:notify` | SMS/WhatsApp paths |
| Knowledge | `npm run test:knowledge` | Ingest/playbooks |
| Live call | Manual test DID call | Voice behavior changes |

Document manual test evidence in PR or release notes.

---

### 9. Migration ledger updated

| Requirement | Location |
| --- | --- |
| New row or updated row | `docs/supabase/MIGRATION_LEDGER.md` |
| Staging apply status | Set after staging validation |
| Introducing commit | SHA after merge |

Template: see ledger **Entry template** section.

---

### 10. Production SQL reviewed

| Reviewer | Checks |
| --- | --- |
| Platform lane | Dependencies, idempotency, RLS, grants, RPC security |
| Feature lane | Behavior matches product spec |
| Security | No broad anon grants; service_role boundaries |

**For SQL releases:** attach script name, predecessor, and expected catalog diff (tables/columns/RPCs).

---

### 11. Rollout / rollback plan exists

| Surface | Plan |
| --- | --- |
| Voice (Railway) | Deploy from `main`; rollback = previous deployment |
| Desk (Vercel) | Merge to `main`; rollback = Vercel instant rollback |
| Database | Forward-fix SQL only; document repair script if needed |
| Feature flags | Env vars (`WALLET_*`, `VOICE_*`) documented |

---

### 12. Production execution explicitly approved

| Requirement | Detail |
| --- | --- |
| Approver | Human operator (not cloud agent default) |
| SQL apply | Record executor, date, script in ledger |
| Post-deploy smoke | `GET /healthz`, test call, desk login |

**Cloud agents:** MUST NOT execute production SQL without explicit user instruction.

---

## Release types

| Type | Gates emphasized |
| --- | --- |
| Code-only | 1, 4–8 (as applicable), 11–12 |
| DB-only | 2–3, 9–12 |
| Full stack | All 12 |

---

## Staging as mandatory pre-production

**FACT:** Staging project exists and was rebuilt from Git (Phase 3E).

All database changes must be applied and verified on staging before production approval.

---

## Automation status

| Gate | Automated today | Notes |
| --- | --- | --- |
| test:voice | **YES** — `ci.yml` on PR | |
| test:mvp | **YES** — `ci.yml` on PR | |
| Desk lint/build | **YES** — `ci.yml` on PR | |
| Release candidate (code) | **YES** — `npm run release:candidate` | Local or scriptable |
| smoke:db | **YES** — `staging-validate.yml` | Requires GitHub secrets |
| Schema verify | **YES** — `staging-validate.yml` | Staging only |
| Ledger | Manual | PR template checkbox |
| Prod approval | Manual | Required indefinitely |

---

## Waiver process

If a gate cannot pass:

1. Document reason in PR.
2. Record risk and compensating control.
3. Obtain explicit human approval.
4. Never waive gates 10–12 for production SQL.

---

## Related documents

- [`RELEASE_PROCESS.md`](../governance/RELEASE_PROCESS.md)
- [`ENVIRONMENT_CONTRACT.md`](./ENVIRONMENT_CONTRACT.md)
- [`../engineering/FEATURE_DEVELOPMENT_CONTRACT.md`](../engineering/FEATURE_DEVELOPMENT_CONTRACT.md)
- [`TESTING_BASELINE.md`](../governance/TESTING_BASELINE.md)
