---
owner: platform
last_reviewed: 2026-10-22
status: plan
---

> **Status: current-state record and plan; nothing changed on Railway. No watch-path change is proposed (keep the 9 patterns). The SQL reconcile it supports awaits Alvin's yes.**
>
> §8 is done: the stale "no watch paths" line was fixed in this PR (#871, `c0e4faa2`).
>
> Reference copy of the box brief `briefs/voice-watch-paths-plan-2026-10-22.md`. Paths under `/workspace/` are box paths and are not in the repo. See [STATUS.md](../../STATUS.md).

# Railway watch paths for Voice: plan (draft, nothing applied)

Prepared 22 Oct 2026, ~08:50 EAT, by Platform, for Scalers Chief. Read-only: Railway `describe-service` and `list-deployments` through the Railway connector, plus the repo at `main` `2f168419`. Nothing was changed on Railway, the DB, or GitHub.

## TL;DR

- **Watch paths already exist on both prod and staging Voice**, with the same 9 patterns. STATUS.md's rule line "Prod Voice has **no watch paths** (18 Oct)" is stale. It is also still in draft #871, which should be fixed before #871 merges.
- **Half of the proof has already happened.** #862 (`7c2e1ae0`, SQL and docs only) merged 22 Oct 01:25 EAT, and prod Voice recorded deployment `80e17cc7` as **SKIPPED**.
- **The other half is still unproven: a src change has not yet triggered a build.** Every merge after #834 that touched a watched path changed only `package.json`: #851, #858, #857, #860, #863 and #867. None of them has a prod Voice deployment record. The likely cause is the Railway outage or build pause. Its exact window is *unverified*.
- **Prod Voice is still on `3bb1d0e3` (#834).** The only watched-path change since then is two `package.json` test-script lines (`git diff 3bb1d0e3 main -- server.js db.js src package*.json Dockerfile .dockerignore railway.toml`). So the next prod Voice build ships no runtime change. It does restart Voice.
- **Recommendation:** keep the current pattern list as it is. It matches what the Voice image needs at runtime, so no change is needed. Own the list in Railway service settings, not `railway.toml`. Prove the src half on the next Voice merge.

## 1. Current config (read 22 Oct 2026, ~08:40 EAT)

| | Prod Voice `9b09d8c6` (env `8dd0b8ef`) | Staging Voice `e37d143d` (env `99dd41c1`) |
| --- | --- | --- |
| Source | `main`, no commit pin | `cursor/v2-live-spoken-catalog-3e8f`, **`commitSha a0fc061c…`** (the a0fc061 pin; leave it alone) |
| Root directory | none (repo root) | none |
| Builder (service setting) | `RAILPACK` | `RAILPACK` |
| Config as code | `railway.toml` at the repo root (Railway reads it automatically; `railwayConfigFile` is not set). It sets `builder = "DOCKERFILE"`, `dockerfilePath = "Dockerfile"`, `healthcheckPath = "/healthz"`, `healthcheckTimeout = 30`, restart `ON_FAILURE` ×5. **No `watchPatterns`**, so the service-level patterns apply. | same file at whatever commit staging builds |
| Start command (service) | `npm start` → `node server.js`. The Dockerfile `CMD` is also `node server.js`. | `npm start` |
| Watch patterns | `/server.js`, `/db.js`, `/src/**`, `!/src/**/*.md`, `/package.json`, `/package-lock.json`, `/Dockerfile`, `/.dockerignore`, `/railway.toml` | identical |
| Staged changes | none | none |
| Latest deployment | `cad5c544` SUCCESS, 20 Oct 18:16 EAT, `3bb1d0e3` (#834). Then `80e17cc7` **SKIPPED** at 22 Oct 01:25 EAT for `7c2e1ae0` (#862). | `e552fae7` SUCCESS, 20 Oct 17:51 EAT. `/healthz` reports `c67d76c1`. |

When the patterns were set:
- Staging: 21 Oct 13:24 EAT, per Platform's earlier brief `voice-watch-paths-prod-change.md`.
- Prod: still unset at 21 Oct 13:25 EAT (same brief) and present by #862's skip at 22 Oct 01:25 EAT. When prod was applied and who approved it is *unverified* here.
- That earlier brief was the C5 prod-change proposal. This one supersedes it as the current-state record.

## 2. What the Voice build and runtime actually read

**Dockerfile** (used, because `railway.toml` says `DOCKERFILE`):
- `COPY package.json package-lock.json`, then `npm ci --omit=dev`.
- `apt-get install espeak-ng`.
- `COPY server.js db.js`, `COPY src`, `COPY scripts`, `COPY docs`.
- `CMD node server.js`.

**`.dockerignore`:** excludes `*.md` except `!docs/**`, plus `node_modules`, `.env*`, `.git`, `.cursor`, `coverage`, `tmp`.

**Runtime reads (grep of `server.js`, `db.js`, `src/`, excluding tests):**
- Root `db.js` is only `module.exports = require('./src/db')`.
- Data files are all under `src/`: `src/speech/pcm/*` (line-unavailable and outage clips), `src/data/*`, `src/speech/data/*`, `src/conversation/data/*`.
- `src/speech/phoneticEngine.js` reads `word-list/words.txt` from `node_modules`. That comes in through `package-lock.json`.
- `src/speech/voiceTrace.js` writes `data/voice-traces.jsonl` at runtime only when JSONL tracing is on. It writes and doesn't read, and it isn't in git.
- `server.js:667` reads `scripts/.deploy-sha` **only as a fallback** after `RAILWAY_GIT_COMMIT_SHA` / `GIT_SHA`. The file isn't committed, and Railway sets `RAILWAY_GIT_COMMIT_SHA`.
- **Nothing reads `docs/` at runtime.** Every `docs/...` string in `src/` is a log hint or a code comment ("apply docs/supabase/x.sql").
- **Nothing reads `supabase/`, `dashboard/`, `packages/`, `evals/` or `tests/` at runtime.**
  - One cross-dir `require` exists: `src/billing/invoiceNotices.js` requires `../../dashboard/src/lib/invoicePay/money`. Only `tests/invoiceDocuments.test.js` loads that module. It isn't reachable from `server.js`, which is good, because the Docker image has no `dashboard/`.
  - `scripts/billing-payment-reconcile.js` and `scripts/render-sample-invoice.js` require `dashboard/` too. They are CLI scripts, not Voice runtime.
- **`src/**/*.md`:** the only one is `src/speech/pcm/README.md`. Nothing reads it, so `!/src/**/*.md` is safe. (`src/AGENTS.md` and `src/CLAUDE.md` exist too, and the exclusion covers them.)
- There are no `railway.json`, `nixpacks.toml`, `railpack.json` or `Procfile` files. `render.yaml` exists, but it's for the Render alternate, not Railway.

## 3. Exact pattern list (recommended, the same as today)

```
/server.js
/db.js
/src/**
!/src/**/*.md
/package.json
/package-lock.json
/Dockerfile
/.dockerignore
/railway.toml
```

Deliberately **not** watched, even though the Dockerfile copies them:
- `/scripts/**`: not read at runtime. The image carries a possibly stale copy, which is harmless.
- `/docs/**`: not read at runtime.

These are also not watched, and correctly so: `dashboard/`, `supabase/`, `tests/`, `.github/`, `evals/`, `packages/`, root `*.md`, `render.yaml`, `lychee.toml`, `skills-lock.json`.

**Optional follow-up**, a separate Voice-window PR, not needed now:
- Drop `COPY scripts ./scripts` and `COPY docs ./docs` from the Dockerfile, so the image matches the watch list and is smaller.
- It's a small behaviour change: the `.deploy-sha` fallback goes away, and only `RAILWAY_GIT_COMMIT_SHA` remains.
- If you take it, run the voice and mvp gates and check `/healthz` `gitSha`.

**Known noise:** `package.json` holds both the runtime dependencies and every `test:*` script. Railway can't watch individual JSON keys, so a PR that only adds a test file to `test:mvp` rebuilds and restarts prod Voice. That covers 6 of the 7 merges since #835. Two options:
- (a) Accept it, and do the live-call check before any merge that touches `package.json`.
- (b) Later, move the test lists into a separate file such as `scripts/test-lists.json`, read by a small runner. That PR touches `package.json` once.

I recommend (a) for now.

## 4. How to set it (if it ever needs changing)

The recommendation: **Railway service settings via `update-service` with `watchPatterns`, scoped per environment (`environmentId`), and not staged.** Per platform notes, watch-path changes are non-staged update-service calls. Don't pass a service without `environmentId`, because that updates every environment.
- Staging first: `update-service { projectId, serviceId: e37d143d…, environmentId: 99dd41c1…, watchPatterns: [...] }`.
- Then prod with Alvin's yes in Platform's chat: `serviceId: 9b09d8c6…, environmentId: 8dd0b8ef…`.
- A watch-pattern change applies to the next push. It doesn't redeploy by itself.
- **Don't** use `staged: true` + `accept-deploy`, because `accept-deploy` forces a deploy. Do a live-call check before any prod change anyway.

**Not recommended: `watchPatterns` in `railway.toml`** (config as code, which overrides the UI).
- `railway.toml` is shared by both environments, so staging and prod can't differ.
- Adding it needs a merge to `main`, and `/railway.toml` is itself watched, so that merge rebuilds prod Voice.
- A later edit to the file could silently override the UI list.

Keep `railway.toml` without `watchPatterns`, and add this comment in a future Voice PR: "watch patterns live in Railway service settings; see STATUS.md".

## 5. Risks

- **A needed file is missed, so a Voice change doesn't deploy.** Today everything the runtime reads is under `src/`, `server.js`, `db.js` or `node_modules` (lockfile).
  - Rule: any new runtime asset goes under `src/`. A new top-level runtime file or folder, such as `prompts/` or `config/`, must be added to the pattern list in the same PR.
  - Add a line to `docs/reference/lanes/VOICE.md` and `PLATFORM.md`.
  - A CI guard could fail when `server.js` or `src/**` requires a path outside the watched set. That's cheap: a grep for `require('../` and `__dirname, '..'` reaching outside `src`.
- **A Dockerfile `COPY` of a new dir that the runtime reads**, but the dir isn't watched. The same rule applies.
- **Stale image content under `scripts/` and `docs/`.** Not read, so harmless.
- **Skipped deployments are silent.** After a merge, check prod `/healthz` `gitSha`. If it should have moved and didn't, compare the changed files against the list.
- **Outage interaction.** While Railway builds are paused, even watched merges don't produce a deployment. So `gitSha` lagging `main` is expected right now, and isn't a watch-path fault.

## 6. How to prove it

1. **A non-Voice merge doesn't rebuild:** already proven. #862 → prod deployment `80e17cc7` SKIPPED (22 Oct 01:25 EAT). Repeat it with the next docs-only merge (for example #871, after its stale line is fixed) and expect another SKIPPED record, with `/healthz` `gitSha` unchanged.
2. **A src change does rebuild:** not yet proven. On the next Voice PR merge that touches `src/**` or `server.js`, after the live-call check:
   - Railway should create a BUILDING deployment, then SUCCESS.
   - `/healthz` `gitSha` should equal the merge SHA.
   - Railway has to be building again first.
3. **package.json only:** the next merge that touches only `package.json` should build too, because it's watched. The outstanding ones (#851 … #867) never got a record, which is the outage.
4. **Staging:** the patterns don't matter while staging is pinned to `commitSha a0fc061c`, because a pin ignores pushes. Prove it on prod.

## 7. Rollback

- Clear the patterns with `update-service { …, environmentId, watchPatterns: [] }` per environment. Every push to the tracked branch then rebuilds again.
- Or restore the list above.
- Neither change redeploys by itself.
- Before any change, snapshot the current values. They're listed in §1 (identical on both).

## 8. Fix needed elsewhere

- `docs/STATUS.md` §8 "Deploys" says prod Voice has no watch paths. Replace it with the §1 facts and the #862 SKIPPED proof.
- My draft #871 carries that stale line, and its PR body says merging rebuilds prod Voice, which is wrong. A docs-only merge is skipped. I can push that fix to #871 on request; I haven't, because this task applies nothing.
