# Environment contract

**Status:** Canonical (updated Phase 3G, 2026-08-15)  
**Purpose:** Make it difficult to accidentally point local or staging work at production.

---

## Environment definitions

| Environment | Code | Database project | Purpose |
| --- | --- | --- | --- |
| **LOCAL** | `LOCAL` | Developer-owned Supabase project OR staging (never production) | Day-to-day development |
| **STAGING** | `STAGING` | `sgcdncjxauhsbunobmob` (`scalers-staging`) | Pre-production validation, SQL apply, smoke tests |
| **PRODUCTION** | `PRODUCTION` | `fjxcdccgyhnvnnlnovcl` (ALCR) | Live customers — **read-only for agents** |

---

## Database

| Field | LOCAL | STAGING | PRODUCTION |
| --- | --- | --- | --- |
| Project ref | Dev project or staging | `sgcdncjxauhsbunobmob` | `fjxcdccgyhnvnnlnovcl` |
| URL pattern | `https://<ref>.supabase.co` | `https://sgcdncjxauhsbunobmob.supabase.co` | `https://fjxcdccgyhnvnnlnovcl.supabase.co` |
| Data | Synthetic / disposable | Test + smoke data | Live tenant data |
| SQL apply | Allowed (disposable) | Allowed (rebuild or incremental) | **Human-approved only** |
| Service role in repo | `.env` (gitignored) | Cloud secrets / local `.env` | **Never commit** |

### Safety checks before any DB command

1. Read `SUPABASE_URL` — confirm project ref matches intended environment.
2. **BLOCKER:** If ref is `fjxcdccgyhnvnnlnovcl` → production. Stop unless explicitly approved.
3. Prefer staging ref `sgcdncjxauhsbunobmob` for integration tests.
4. Never paste production credentials into agent chats or commits.

---

## API (voice engine)

| Field | LOCAL | STAGING | PRODUCTION |
| --- | --- | --- | --- |
| Host | `localhost:PORT` + tunnel | Dedicated staging deploy or local+tunnel | Railway (see DEPLOYMENT.md) |
| Health | `GET /healthz` | Same | Same |
| Webhooks | Tunnel URL → SautiKit test DID | Staging voice URL | Production SautiKit config |
| `PUBLIC_BASE_URL` | Tunnel or localhost | Staging public URL | Production Railway URL |

**INFERENCE:** Production voice host `https://scalers-project-production.up.railway.app` (from code/docs; verify in Railway dashboard).

---

## Secrets

| Secret | LOCAL | STAGING | PRODUCTION | Browser exposure |
| --- | --- | --- | --- | --- |
| `SUPABASE_SERVICE_ROLE_KEY` | `.env` | Server-only env | Railway/Vercel server | **NEVER** |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `.env.local` | Vercel staging | Vercel prod | Yes (RLS-bound) |
| `SONIOX_API_KEY` | `.env` | Staging env | Prod env | Never |
| `GEMINI_API_KEY` | `.env` | Staging env | Prod env | Never |
| `SAUTIKIT_API_KEY` | Test keys | Test/staging keys | Production keys | Never |
| `VOICE_INTERNAL_SECRET` | Must match desk | Must match desk | Must match desk | Never |
| `DASHBOARD_PASSWORD` | Optional dev bypass | Staging if used | Legacy Super Admin | Never |

**Rule:** No `NEXT_PUBLIC_*` variable may contain service_role or provider admin keys.

---

## Service role boundaries

| Consumer | Role | Allowed operations |
| --- | --- | --- |
| Voice engine (`server.js`) | `service_role` | Insert/update calls, transcripts, wallet charge RPCs, recording upload |
| Signup provisioner (Auth trigger) | `service_role` (via Supabase internal) | Create tenant, member, DID assign |
| Super Admin APIs (desk server) | `service_role` | DID pool, wallet adjust, tenant admin |
| Owner desk (browser) | `authenticated` + RLS | Read/update own tenant per policies |
| Anonymous | `anon` | Auth endpoints only; no tenant data |

**Invariant:** Wallet mutation RPCs are `service_role` only (enforced in `wallet_security_beta.sql`).

---

## Frontend deployment (desk)

| Field | LOCAL | STAGING | PRODUCTION |
| --- | --- | --- | --- |
| Command | `cd dashboard && npm run dev` | Vercel preview or staging project | Vercel production |
| Root | `dashboard/` | Same | Same |
| URL | `http://localhost:3000` | **UNKNOWN** (no dedicated staging URL in repo) | **INFERENCE:** `https://scalers-project.vercel.app` |
| Auth | Supabase Auth | Staging Supabase project | Production Supabase project |
| Dev bypass | `DASHBOARD_OPEN=true` allowed | **Disable** | **Disable** |

---

## Backend deployment (voice)

| Field | LOCAL | STAGING | PRODUCTION |
| --- | --- | --- | --- |
| Runtime | Node.js | Docker (Railway) | Docker (Railway) |
| Entry | `server.js` | Same | Same |
| Dockerfile | Repo root | Same | Same |
| URL | Tunnel + `localhost:PORT` | **UNKNOWN** (no dedicated staging service in repo) | **INFERENCE:** `https://scalers-project-production.up.railway.app` |
| Health | `GET /healthz` | Same | Same |

---

## External voice provider (Soniox)

| Field | LOCAL | STAGING | PRODUCTION |
| --- | --- | --- | --- |
| STT/TTS | API key in `.env` | Staging key (recommended separate) | Production key |
| Voice catalog | `platform_soniox_voices` table | Staging DB | Production DB |

---

## Telecom provider (SautiKit)

| Field | LOCAL | STAGING | PRODUCTION |
| --- | --- | --- | --- |
| Webhook target | Tunnel URL | Staging voice URL | Production voice URL |
| DID pool | Test DIDs | Staging pool (manual seed) | Production pool |
| Validation | `SAUTIKIT_VALIDATE_WEBHOOKS` | On in staging | On in production |

---

## Storage

| Bucket | LOCAL/STAGING/PROD | Access |
| --- | --- | --- |
| `call-recordings` | All environments (separate projects) | Voice uploads via `service_role` |
| Policies in Git | **NO** | UNKNOWN on production; none on staging |

---

## Observability

| Signal | LOCAL | STAGING | PRODUCTION |
| --- | --- | --- | --- |
| Voice logs | stdout | Railway logs | Railway logs |
| Desk logs | Vercel dev / preview | Vercel | Vercel |
| DB logs | Supabase dashboard | Supabase dashboard | Supabase dashboard |
| Structured tracing | Limited | Same | Same |

**Debt:** Verbose webhook logging may expose PII (TD-P1-4).

---

## Environment mismatch prevention

### Required local setup

```bash
# Root .env — voice engine
SUPABASE_URL=https://<NON-PRODUCTION-REF>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<staging-or-dev-key>

# dashboard/.env.local
NEXT_PUBLIC_SUPABASE_URL=https://<SAME-REF>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon-key-for-same-project>
```

### Pre-flight checklist

- [ ] `SUPABASE_URL` ref is NOT `fjxcdccgyhnvnnlnovcl`
- [ ] Voice and desk use the **same** Supabase project ref
- [ ] `VOICE_INTERNAL_SECRET` matches between voice and desk
- [ ] `VOICE_PUBLIC_BASE_URL` points at the voice instance under test
- [ ] No production service_role in git, PRs, or screenshots

### CI / cloud agents

- Store staging credentials in environment secrets only.
- Default test target: staging (`sgcdncjxauhsbunobmob`).
- Refuse production SQL execution without explicit human approval.

---

## Related documents

- [`ENVIRONMENTS.md`](./ENVIRONMENTS.md) — setup commands
- [`DEPLOYMENT.md`](./DEPLOYMENT.md) — deploy surfaces
- [`RELEASE_GATE.md`](./RELEASE_GATE.md) — pre-production checklist
- [`../database/DATABASE_EVOLUTION.md`](../database/DATABASE_EVOLUTION.md) — SQL apply per environment
