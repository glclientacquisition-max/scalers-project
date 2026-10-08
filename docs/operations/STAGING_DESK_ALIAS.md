# Staging desk alias

**Status:** Staging branch holds the URL (2026-09-30).  
**Project:** Vercel `scalers-staging` (`prj_koYxAaXjOZ9QYA7hVB2SUOEAmyoB`)  
**URL:** `https://scalers-staging.vercel.app`

## Current rule

`scalers-staging.vercel.app` serves the ready deploy of `cursor/staging-voice-468b`. That branch is `main` plus every open pull request, including one that targets another feature branch. The stage workflow assigns the hostname after each rebuild.

A push to `main` must not take this URL. Production desk is `scalers-project` (`scalers.co.ke`). Production voice is Railway. Do not change those from a staging desk fix.

## Why the URL lagged

Builds of `cursor/staging-voice-468b` are preview deploys while the Vercel production branch is `main`. Preview deploys do not take `scalers-staging.vercel.app`. On 2026-09-30 the hostname was still on `main` `30cb471` while staging voice was on `9e60d9ac`.

## Settings (`scalers-staging` only)

The stage workflow reapplies these on each run:

1. Ignored Build Step builds only `cursor/staging-voice-468b` and exits 0 for every other branch, including `main`. This project setting is the fallback for commits without the repo rule below.
2. `autoAssignCustomDomains` is off, so a production deploy does not take the hostname.
3. The workflow assigns `scalers-staging.vercel.app` to the ready deploy of `cursor/staging-voice-468b` only.

`dashboard/vercel.json` is shared with production `scalers-project`. Its `ignoreCommand` (`dashboard/scripts/vercel-ignore-build.sh`) overrides the project setting and branches on `VERCEL_PROJECT_ID`. On `scalers-staging` it builds only `cursor/staging-voice-468b`. On `scalers-project` production and `main` always build, and previews build only when `dashboard/` changed. Keep the staging branch building on `scalers-staging`, or the alias step times out waiting for a READY deploy. Rules: [`ENVIRONMENTS.md`](./ENVIRONMENTS.md#vercel-builds-ignored-build-step).

## Agent rules

- Test a single PR on its Vercel preview URL. The shared staging URL is `https://scalers-staging.vercel.app` after the stage workflow assigns it.
- Do not `create_deployment` with `target: production` of a feature branch onto `scalers-staging`.
- Do not assign `scalers-staging.vercel.app` to a feature branch, `main`, or `cursor/staging-live-679d`.
- Do not change production Railway voice or `scalers-project` from this note.

## GitHub secret

`VERCEL_TOKEN` on the repository. The workflow exits if it is missing, and the hostname stays where it is. The token needs access to project `scalers-staging` on team `team_pZLbtKTricc6PI2UG9KutoFN`.
