# Storage security model — call-recordings

**Status:** Phase 3G (2026-08-15)  
**Bucket:** `call-recordings` (private)

---

## Application requirements (from code)

### Upload path

| Item | Detail | Evidence |
| --- | --- | --- |
| Client | Voice engine `service_role` | **FACT** — `src/lib/supabaseClient.js` |
| Function | `uploadRecordingBuffer()` | **FACT** — `src/db.js` |
| Bucket | `SUPABASE_RECORDINGS_BUCKET` or `call-recordings` | **FACT** — `src/db.js` |
| Object path | `{callSid}/{recordingSid\|timestamp}.{ext}` | **FACT** — `src/db.js` |
| Upsert | `upsert: true` | **FACT** |
| Auth | service_role bypasses Storage RLS | **INFERENCE** — Supabase default |

### Read path

| Consumer | Method | Evidence |
| --- | --- | --- |
| Voice engine | `createSignedUrl` (7-day TTL) stored in `calls.recording_url` | **FACT** — `src/db.js` |
| Owner desk | `CallAudioPlayer` plays `recording_url` directly | **FACT** — `calls/[id]/page.tsx` |
| Gemini Scan | `fetch(recording_url)` server-side | **FACT** — `pronunciationGeminiScan.ts` |
| Anonymous | No direct storage API | **FACT** — no desk storage client |

### Delete path

| Item | Detail | Evidence |
| --- | --- | --- |
| Application delete | **Not implemented** in `src/db.js` | **FACT** |
| Super Admin tenant delete | Deletes calls/transcripts rows, not storage objects | **FACT** — `super_admin_ops.sql` |

---

## Known infrastructure state

| Environment | Bucket exists | Public | Policies in Git |
| --- | --- | --- | --- |
| Production | **YES** (2026-08-06) | **false** | **UNKNOWN** |
| Staging | **YES** (Phase 3E) | **false** | **NONE** (0 rows in `pg_policies` for storage) |

**FACT:** Staging has no storage RLS policies; voice smoke upload **PASS** via service_role.

**UNKNOWN:** Whether production has storage policies not reproduced in Git.

---

## Security assessment

| Risk | Level | Notes |
| --- | --- | --- |
| service_role key leak | **P0** | Full bucket access — standard Supabase model |
| Signed URL leak | **P2** | Time-limited (7 days); URL grants read to holder |
| anon direct list/read | **Low** if bucket private + no policies | **UNKNOWN** on production |
| Cross-tenant read via signed URL | **P2** | Anyone with URL can play; URLs not guessable |
| Owner read without signed URL refresh | **P3** | Desk uses stored URL; may expire |

---

## FACT / INFERENCE / UNKNOWN / PROPOSED

### FACT

- Voice uploads use service_role only.
- Bucket is private on staging and documented private on production.
- Recordings are referenced by HTTPS signed URLs in `calls.recording_url`.
- No Git SQL defines storage policies today.

### INFERENCE

- Production voice path matches staging (service_role upload works without storage policies).
- Desk playback depends on signed URL remaining valid.

### UNKNOWN

- Production `storage.objects` RLS policies.
- Whether expired signed URLs are refreshed anywhere.
- Orphaned storage objects after tenant delete.

### PROPOSED

Prepared artifact: [`../supabase/production_pending/storage_call_recordings_policies.sql`](../supabase/production_pending/storage_call_recordings_policies.sql)

- `service_role` ALL on `call-recordings` bucket objects.
- `authenticated` SELECT where object path matches a call in member tenant.
- No authenticated write (upload stays service_role).

**NOT APPLIED** to production or staging in Phase 3G.

---

## Staging vs production policy gap

| Item | Staging | Production |
| --- | --- | --- |
| Policies | 0 | **UNKNOWN** |
| Voice upload works | **YES** | **INFERRED YES** |
| Defense-in-depth owner read policy | **NO** | **UNKNOWN** |

---

## Verification before production policy apply

1. Review PROPOSED SQL with Platform + Security.
2. Apply to **staging** first; run `npm run smoke:db`.
3. Confirm desk recording playback still works.
4. Human approve production apply.
5. Ledger entry for storage policies.

---

## Related documents

- [`PRODUCTION_CHANGE_NOTIFY_CHANNELS.md`](../operations/PRODUCTION_CHANGE_NOTIFY_CHANNELS.md)
- [`../database/SCHEMA_DRIFT_POLICY.md`](../database/SCHEMA_DRIFT_POLICY.md)
- [`../operations/ENVIRONMENT_CONTRACT.md`](../operations/ENVIRONMENT_CONTRACT.md)
