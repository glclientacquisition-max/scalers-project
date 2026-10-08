#!/usr/bin/env bash
# Vercel Ignored Build Step for the Desk (dashboard/) on both Vercel projects.
# Wired from dashboard/vercel.json "ignoreCommand". Vercel runs it from the
# project Root Directory (dashboard/) after a shallow clone (depth 10).
#
# Exit 0 = SKIP the build. Exit 1 = BUILD. Any other non-zero exit also builds,
# so a crash or unexpected git error fails safe (builds, like today).
#
# Rules, in order:
#   scalers-staging (prj_koYx...):
#     - build only cursor/staging-voice-468b. Stage-PR aliases
#       scalers-staging.vercel.app to the READY deploy of that branch at the
#       exact staging SHA, so it must always build there.
#     - skip every other branch, including main (main skip matches the
#       Ignored Build Step that Stage-PR has always set on this project).
#   scalers-project (prod Desk, prj_GYOg...) and any unknown project:
#     - VERCEL_ENV=production or branch main: always build.
#     - unknown project or missing VERCEL_PROJECT_ID: build (fail safe).
#     - cursor/staging-voice-468b: skip (only scalers-staging serves it).
#     - other previews: build only if the commit range touches a Desk path.
#
# Desk paths: dashboard/ (the Next app, its own package.json and lockfile,
# this script and dashboard/vercel.json). Nothing under dashboard/ imports
# from outside it (checked 2026-10-08; next.config pins outputFileTracingRoot
# and turbopack.root to dashboard/). Add a path to DESK_PATHS if that changes.
#
# Local dry run: VERCEL_PROJECT_ID=... VERCEL_ENV=preview \
#   VERCEL_GIT_COMMIT_REF=my-branch VERCEL_GIT_COMMIT_SHA=<sha> \
#   VERCEL_GIT_PREVIOUS_SHA=<sha> bash dashboard/scripts/vercel-ignore-build.sh

set -u

STAGING_PROJECT_ID="prj_koYxAaXjOZ9QYA7hVB2SUOEAmyoB"
PRODUCTION_DESK_PROJECT_ID="prj_GYOgX3yjVowvQ1hd7D1c0AWOovpx"
STAGING_BRANCH="cursor/staging-voice-468b"
DESK_PATHS="dashboard/"

project="${VERCEL_PROJECT_ID:-}"
env_name="${VERCEL_ENV:-}"
ref="${VERCEL_GIT_COMMIT_REF:-}"
url="${VERCEL_URL:-}"

build() { echo "vercel-ignore: BUILD ($1)"; exit 1; }
skip() { echo "vercel-ignore: SKIP ($1)"; exit 0; }

echo "vercel-ignore: project=${project:-unset} env=${env_name:-unset} ref=${ref:-unset} sha=${VERCEL_GIT_COMMIT_SHA:-unset} previous=${VERCEL_GIT_PREVIOUS_SHA:-unset}"

# Recognise scalers-staging by id, or by its deployment hostname if the id is absent.
is_staging=0
if [ "$project" = "$STAGING_PROJECT_ID" ]; then
  is_staging=1
elif [ -z "$project" ] && case "$url" in scalers-staging-*) true ;; *) false ;; esac; then
  is_staging=1
fi

if [ "$is_staging" = 1 ]; then
  if [ "$ref" = "$STAGING_BRANCH" ]; then
    build "scalers-staging builds $STAGING_BRANCH for the Stage-PR desk alias"
  fi
  skip "scalers-staging builds only $STAGING_BRANCH, not ${ref:-an unnamed ref}"
fi

if [ "$env_name" = "production" ]; then
  build "production deploy"
fi
if [ "$ref" = "main" ]; then
  build "main"
fi
if [ -z "$project" ]; then
  build "VERCEL_PROJECT_ID is not set"
fi
if [ "$project" != "$PRODUCTION_DESK_PROJECT_ID" ]; then
  build "unknown project $project"
fi
if [ "$ref" = "$STAGING_BRANCH" ]; then
  skip "$STAGING_BRANCH is served by scalers-staging only"
fi

top="$(git rev-parse --show-toplevel 2>/dev/null)" || build "not a git checkout"
cd "$top" || build "cannot cd to the repo root"

head_sha="${VERCEL_GIT_COMMIT_SHA:-}"
if [ -z "$head_sha" ] || ! git cat-file -e "${head_sha}^{commit}" 2>/dev/null; then
  head_sha="HEAD"
fi

prev="${VERCEL_GIT_PREVIOUS_SHA:-}"
if [ -n "$prev" ]; then
  if git cat-file -e "${prev}^{commit}" 2>/dev/null; then
    base="$prev"
    how="last built SHA"
  else
    # Previous build is beyond the shallow clone or was force-pushed away.
    build "last built SHA $prev is not in the clone"
  fi
elif git rev-parse -q --verify "${head_sha}^{commit}" >/dev/null 2>&1 && git rev-parse -q --verify "${head_sha}^" >/dev/null 2>&1; then
  # First deploy of this branch on this project: only the tip commit is checked.
  base="${head_sha}^"
  how="first deploy of this branch, HEAD^ fallback"
else
  build "no parent commit to compare (shallow clone or root commit)"
fi

# shellcheck disable=SC2086
git diff --quiet "$base" "$head_sha" -- $DESK_PATHS
status=$?
case "$status" in
  0) skip "no Desk change since $how ($base)" ;;
  1) build "Desk files changed since $how ($base)" ;;
  *) build "git diff failed with status $status" ;;
esac
