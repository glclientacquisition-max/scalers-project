# Environments

**Status:** Governance baseline (2026-08-14)  
**Secrets:** Variable **names** only — never values.

---

## Summary

| Environment | Voice | Desk | Database | Status |
| --- | --- | --- | --- | --- |
| **Development** | Local `npm start` + tunnel | Local `npm run dev` | Supabase project (dev) | **ACTIVE** |
| **Staging** | Railway `staging` on `cursor/staging-voice-468b` | Vercel `scalers-staging` on `cursor/staging-voice-468b` | `sgcdncjxauhsbunobmob` (`scalers-staging`) | **ACTIVE** |
| **Production** | Railway (referenced) | Vercel (referenced) | ALCR `fjxcdccgyhnvnnlnovcl` | **ACTIVE** |

Staging Desk and Voice both follow **`cursor/staging-voice-468b`**. See [`DEVELOPMENT_WORKFLOW.md`](../governance/DEVELOPMENT_WORKFLOW.md).

---

## Development

### Voice engine

```bash
cp .env.example .env
npm ci && npm start
```

| Concern | Setup |
| --- | --- |
| Public webhook URL | `npm run tunnel` or `npm run tunnel:cloudflared` — see `docs/operations/WEBHOOK_TUNNEL.md` |
| SautiKit | Point test DID webhook at tunnel URL |
| Required env | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` |
| Optional | `GEMINI_API_KEY`, `SONIOX_API_KEY`, `SAUTIKIT_*` |

`PUBLIC_BASE_URL` optional — Stream URLs can use request `Host` header.

### Dashboard

```bash
cd dashboard
cp .env.example .env.local
npm ci && npm run dev
```

| Variable | Purpose |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Browser + server Auth |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Owner RLS client |
| `SUPABASE_SERVICE_ROLE_KEY` | Server admin (never browser) |
| `GEMINI_API_KEY` | Prompt compile (local fallback if unset) |
| `VOICE_PUBLIC_BASE_URL` | Desk → voice TTS preview |
| `VOICE_INTERNAL_SECRET` | Must match voice engine for preview auth |
| `DASHBOARD_OPEN=true` | Skip login when no password (dev only) |

### Development bypasses

- `VOICE_INTERNAL_SECRET` unset + `NODE_ENV !== 'production'` → TTS preview auth allowed (`server.js` `voicePreviewAuthorized`)
- `DASHBOARD_OPEN=true` → desk open without password

**Do not enable bypasses in production.**

---

## Staging

**Status:** Updated Phase 3F (2026-08-15)

Staging is defined. See [`ENVIRONMENT_CONTRACT.md`](./ENVIRONMENT_CONTRACT.md) for safety rules.

| Field | Value |
| --- | --- |
| Name | `scalers-staging` |
| Project ref | `sgcdncjxauhsbunobmob` |
| URL | `https://sgcdncjxauhsbunobmob.supabase.co` |
| Region | `eu-west-2` |
| Rebuilt from Git | YES (Phase 3E, manual SQL path) |
| Evidence | [`STAGING_REBUILD_EXECUTION_REPORT.md`](./STAGING_REBUILD_EXECUTION_REPORT.md) |

| Component | Staging target |
| --- | --- |
| Supabase | `sgcdncjxauhsbunobmob` (no production data) |
| Voice | `https://scalers-staging-staging.up.railway.app` (Railway env `staging`, branch `cursor/staging-voice-468b`) |
| Desk | `https://scalers-staging.vercel.app` (Vercel project `scalers-staging`, same branch). Builds from any other branch are ignored. See [Vercel builds](#vercel-builds-ignored-build-step). Why the URL used to flip: [`STAGING_DESK_ALIAS.md`](./STAGING_DESK_ALIAS.md). |
| Git branch | **`cursor/staging-voice-468b`**. Every open pull request is merged onto this branch for testing, including one that targets another feature branch. Open the pull request into `main` so the rebuild starts immediately. A stacked pull request joins on the next rebuild. Promote by squash-merging that tested pull request into `main`. |
| SautiKit | Test DID `+254709221537` (Done and Dusted, agent Shy) pointing at staging voice URL |

### Hold staging Voice

Stage-PR (`.github/workflows/stage-pull-request.yml`) force-pushes `cursor/staging-voice-468b`, then calls Railway `serviceConnect` on **scalers staging** Voice with that branch and no commit SHA. Railway autodeploys a push to the connected branch. A commit pin ignores later pushes, so `serviceConnect` is what clears the pin and makes Voice follow the branch again. A hold skips the push and that connect. Nothing in this workflow re-points or redeploys Railway staging while the hold is on. The desk alias step is skipped too, because it reads the rebuild result. The next run with no hold rebuilds the branch, connects Voice, and assigns the desk host as usual.

Either switch is enough. The workflow reads both when it runs. Set the hold before the listen. Adding the label does not start a run by itself, and a run already past the hold check still finishes.

**Repository variable.** Settings, Secrets and variables, Actions, Variables. Name `STAGE_PR_HOLD`. Values `1`, `true`, and `on` hold (any case, surrounding space ignored). Empty, unset, `0`, `false`, and `off` do not. Other values do not. Delete the variable, or set `0`, `false`, or `off`, to clear it.

**Label.** Add `hold-staging` to any open pull request. The check is every open pull request, not only the one that triggered the run. Remove the label, or close that pull request, to clear this switch on the next run.

Create the label once if it is missing:

```bash
gh label create hold-staging --repo glclientacquisition-max/scalers-project --description "Skip Stage-PR Railway staging re-point" --color B60205
```

Add it with `gh pr edit NUMBER --add-label hold-staging`. Remove it with `gh pr edit NUMBER --remove-label hold-staging`.

**While held.** The log and the job summary include a line like:

`Stage-PR hold active (STAGE_PR_HOLD=1 / label hold-staging on #NNN): skipping staging re-point`

The parenthetical names only the switch that fired. `cursor/staging-voice-468b` is not updated. Railway `serviceConnect` does not run. The desk alias does not run. Closing a pull request during a hold does not take it off the branch until the next run with no hold.

**After the listen.** Clear the variable and remove the label. Re-run the latest Stage pull request workflow, or wait for the next pull request event against `main` or the next push to `main`. That run connects Voice to `cursor/staging-voice-468b` again with no commit SHA.

### Vercel builds (Ignored Build Step)

Both Vercel projects use Root Directory `dashboard/`, so both read `dashboard/vercel.json`. Its `ignoreCommand` runs `dashboard/scripts/vercel-ignore-build.sh` before every Git build. Exit 0 skips the build (the deploy shows as Canceled, "Ignored Build Step"). Exit 1 builds.

| Project | Builds | Skips |
| --- | --- | --- |
| `scalers-staging` | `cursor/staging-voice-468b` only, every push. The Stage-PR desk alias needs a READY deploy at the exact staging SHA. | Every other branch, including `main` and pull request branches. |
| `scalers-project` (prod Desk) | Production (`VERCEL_ENV=production`) and `main`, always. Previews whose commits touch `dashboard/` since the branch's last built SHA. | `cursor/staging-voice-468b`. Previews that change nothing under `dashboard/` (Voice, Brain, docs, CI, root tests). |

The range is `VERCEL_GIT_PREVIOUS_SHA..VERCEL_GIT_COMMIT_SHA`. On a branch's first deploy there is no previous SHA, so only the tip commit (`HEAD^..HEAD`) is checked. When the previous SHA is outside the depth-10 clone, the script builds. An unknown project, a missing `VERCEL_PROJECT_ID`, or a git error also builds.

Nothing under `dashboard/` imports from outside it. If the Desk starts to import a file outside `dashboard/`, add that path to `DESK_PATHS` in the script, or previews will go stale. Tests: `node --test tests/vercelIgnoreBuild.test.js` (part of `npm run test:stage-pr`).

Commits that predate this file fall back to the project setting. Stage-PR sets that on `scalers-staging` only (`scripts/stage-desk-alias.js`), and it now builds only `cursor/staging-voice-468b`.

Validate database changes on staging before production. Never use production credentials for staging tests.

**Promote to production:** [`STAGING_TO_PRODUCTION.md`](./STAGING_TO_PRODUCTION.md)

---

## Production

### Referenced URLs (not verified live in audit)

| Service | URL (from code/docs) |
| --- | --- |
| Voice | `https://scalers-project-production.up.railway.app` |
| Desk | `https://scalers-project.vercel.app` |

### Production env (names only)

**Voice** — see root `.env.example`:

- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
- `SONIOX_API_KEY`, `GEMINI_API_KEY`, `GEMINI_MODEL`
- `SAUTIKIT_API_KEY`, `SAUTIKIT_WEBHOOK_SECRET`, `SAUTIKIT_VALIDATE_WEBHOOKS`
- `TEXTSMS_*`, `RESEND_*`, `ALERT_EMAIL_FROM`
- `WALLET_*`, `VOICE_*`, `PUBLIC_BASE_URL`, `VOICE_INTERNAL_SECRET`

**Desk** — see `dashboard/.env.example`:

- `NEXT_PUBLIC_SUPABASE_*`, `SUPABASE_SERVICE_ROLE_KEY`
- `GEMINI_*`, `SAUTIKIT_*`, `SAUTIKIT_ADMIN_OPS_KEY`
- `VOICE_PUBLIC_BASE_URL`, `VOICE_INTERNAL_SECRET`
- `BETTER_AUTH_SECRET`, `ADMIN_ACCESS_CODE` / `ADMIN_OPERATORS`, `ADMIN_HOST` (Super Admin)
- `DASHBOARD_PASSWORD` (HMAC leftover)

### Cross-service secrets that must match

| Variable | Must match between |
| --- | --- |
| `VOICE_INTERNAL_SECRET` | Railway voice ↔ Vercel desk |
| `SUPABASE_URL` | Voice ↔ desk ↔ same project |
| `VOICE_PUBLIC_BASE_URL` | Desk → voice host for preview and DID routing |

---

## External integrations by environment

| Integration | Dev | Staging | Prod |
| --- | --- | --- | --- |
| SautiKit | Test keys / tunnel | Test/staging keys | Production keys |
| Soniox | API key | Staging key | API key |
| Gemini | API key | Staging key | API key |
| TextSMS | Optional | Staging/test | Production |
| Supabase | Dev or staging project | `sgcdncjxauhsbunobmob` | ALCR `fjxcdccgyhnvnnlnovcl` |

---

## Related documents

- [`DEPLOYMENT.md`](./DEPLOYMENT.md)
- [`../governance/HISTORY_GAPS.md`](../governance/HISTORY_GAPS.md)
- [`ENVIRONMENT_CONTRACT.md`](./ENVIRONMENT_CONTRACT.md)
- [`RELEASE_GATE.md`](./RELEASE_GATE.md)
