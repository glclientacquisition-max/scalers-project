#!/usr/bin/env bash
# Baseline: 3 builds x flag profiles, noisy model (30% fault/turn) and clean model (0%).
set -e
cd "$(dirname "$0")/../.."
MAIN=${MAIN_ROOT:-$PWD}; CUR=${CURATED_ROOT:-/workspace/ba-v2-stage-6b7b}; LIVE=${LIVE_ROOT:-/workspace/wt-stage}
for fr in 0.3 0; do
  export EVAL_FAULT_RATE=$fr; sfx=$([ "$fr" = 0 ] && echo -clean || echo "")
  node evals/v2/run.js --root "$MAIN" --label main-7d870a75$sfx --flags prod
  node evals/v2/run.js --root "$CUR"  --label curated-staging-6b7b87a$sfx --flags staging
  node evals/v2/run.js --root "$LIVE" --label live-staging-7dbf40e$sfx --flags staging
  node evals/v2/run.js --root "$LIVE" --label live-staging-7dbf40e$sfx --flags staging+ci
done
