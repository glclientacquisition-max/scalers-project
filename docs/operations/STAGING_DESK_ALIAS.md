# Staging desk alias

**Status:** Main tracks the alias (2026-09-29). The 2026-09-25 pin is lifted.  
**Project:** Vercel `scalers-staging` (`prj_koYxAaXjOZ9QYA7hVB2SUOEAmyoB`)  
**URL:** `https://scalers-staging.vercel.app`

## Current rule

`scalers-staging.vercel.app` is the project production alias. A push or merge to `main` is a git production deploy of `scalers-staging`. That deploy takes the alias.

Production desk is a different project (`scalers-project`, `scalers.co.ke`). Production voice is Railway. Do not change those from a staging desk fix.

## Why main builds were canceled

On 2026-09-25 the project was pinned so a desk stack off `main` could hold the URL:

1. Ignored Build Step exited 0 when `VERCEL_GIT_COMMIT_REF` was `main`. Vercel canceled those production deploys as ignored-build (`errorLink` points at the ignored-build-step docs).
2. `autoAssignCustomDomains` was off, so a new production deploy did not assign `scalers-staging.vercel.app`.

Git pushes of `main` (including `f4b8ea70`, #443) created `CANCELED` deploys. The alias stayed on `cursor/staging-voice-468b` (`f3fb0e8`).

That pin is lifted. #443 is on `main` and on production desk. Staging serves the same SHA.

## Settings (`scalers-staging` only)

1. Ignored Build Step is cleared. Builds from `main` run.
2. `autoAssignCustomDomains` is on. A production deploy of `main` assigns `scalers-staging.vercel.app`.
3. Do not put an `ignoreCommand` in `dashboard/vercel.json`. That file is shared with production `scalers-project`.

Do not restore the main ignore. Do not turn auto-assign off to park a feature SHA on this URL.

## Agent rules

- Test a single PR on its Vercel preview URL.
- Do not `create_deployment` with `target: production` of a feature branch onto `scalers-staging`.
- Do not assign `scalers-staging.vercel.app` to `cursor/staging-voice-468b` or `cursor/staging-live-679d`.
- Do not change production Railway voice or `scalers-project` from this note.

## Green check (2026-09-29)

| | SHA |
| --- | --- |
| `origin/main` | `f4b8ea70df6db7c85548408db3973dfee272d528` |
| Alias `scalers-staging.vercel.app` | `f4b8ea70df6db7c85548408db3973dfee272d528` |
| Deployment | `dpl_4sqb5imqxPftuKU1rzQGqXB4U1c6` (`READY`, production) |
| Production desk `scalers.co.ke` | same SHA, project `scalers-project`, unchanged by this fix |
