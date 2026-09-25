# Staging desk alias pin

**Status:** Canonical (2026-09-25)  
**Project:** Vercel `scalers-staging` (`prj_koYxAaXjOZ9QYA7hVB2SUOEAmyoB`)  
**URL:** `https://scalers-staging.vercel.app`

## The issue

`scalers-staging.vercel.app` is the project production alias. A push to `main` is a git production deploy. That deploy takes the alias.

Desk work still lives on stacked `cursor/*` branches. Those commits are not on `main`. Agents then promote a feature SHA onto the alias. The next merge to `main` (skills install, voice opener, anything) puts `main` back on the URL. The desk changes are still in git. The URL is not serving them.

This is not a UI revert. It is alias theft.

Evidence on 2026-09-25:

| Time (UTC) | What served `scalers-staging.vercel.app` | Source |
| --- | --- | --- |
| 09:27 | `56f38a2` Updates Pick / From Now / Later | Manual production deploy of `cursor/updates-when-679d` |
| 10:02 | `8bf0725` First-forward opener (#418) | Git production deploy of `main` |
| 10:04 | `861924f` Agent skills (#419) | Git production deploy of `main` |

`56f38a2` is not an ancestor of `main`. Twenty-two desk commits sit on the stack and vanish from the URL whenever `main` moves.

Production desk is a different project (`scalers-project`). Production voice is Railway. Do not change those from this pin.

## The pin

Vercel project `scalers-staging` now:

1. **Ignores git builds from `main`.** Ignored Build Step exits 0 when `VERCEL_GIT_COMMIT_REF` is `main`.
2. **Does not auto-assign the production alias.** `autoAssignCustomDomains` is off. A new production deploy does not steal `scalers-staging.vercel.app`.
3. **Serves `cursor/staging-live-679d`.** That branch is the desk stack tip. Move the alias with an explicit assign, not a random feature SHA.

`cursor/staging-live-679d` is a pointer. Fast-forward or reset it to the stack tip you want owners to see. Then assign `scalers-staging.vercel.app` to that deployment.

Do not put an `ignoreCommand` in `dashboard/vercel.json`. That file is shared with production `scalers-project`.

## Agent rules

- Test a single PR on its Vercel preview URL.
- To put a stack on the live staging URL: update `cursor/staging-live-679d`, deploy that branch, assign the alias.
- Do not `create_deployment` `target: production` of an arbitrary feature branch onto `scalers-staging`.
- Do not merge the desk stack to `main` just to refresh this URL. `main` still deploys production desk (`scalers-project`).
- Do not change production Railway voice from a staging desk pin.

## Restore

If the URL is on `main` again:

1. Confirm `get_deployment` for `scalers-staging.vercel.app` (`githubCommitRef`).
2. Assign the alias to the latest READY deploy of `cursor/staging-live-679d`.
3. Confirm the Ignored Build Step and `autoAssignCustomDomains` are still set on `scalers-staging` only.
