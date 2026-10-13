#!/usr/bin/env node
// One-off catch-up of post-call reviews (call_facts) from stored transcripts.
// Needs the voice server env (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, GEMINI_API_KEY).
// Usage: node scripts/backfill-call-reviews.js [--days 14] [--limit 50]
'use strict';
require('dotenv').config();
const { sweepUnreviewedCalls } = require('../src/conversation/callTranscriptReview');

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  const n = i >= 0 ? Number(process.argv[i + 1]) : NaN;
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

sweepUnreviewedCalls({ sinceDays: arg('days', 14), limit: arg('limit', 50) })
  .then((res) => {
    console.log(JSON.stringify(res));
    process.exit(0);
  })
  .catch((err) => {
    console.error(err?.message || err);
    process.exit(1);
  });
