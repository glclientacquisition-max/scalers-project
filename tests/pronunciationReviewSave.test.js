/**
 * Pronunciation review write errors.
 * An empty Fix queue is a load. A failed listen save names the listen.
 * Run: node --test tests/pronunciationReviewSave.test.js
 */
"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const helperPath = path.join(
  __dirname,
  "../dashboard/src/lib/ownerFacingError.ts"
);
const actionPath = path.join(
  __dirname,
  "../dashboard/src/app/(desk)/settings/pronunciationGeminiScanActions.ts"
);

function loadWriteError() {
  const script = `
    import { pronunciationWriteError } from ${JSON.stringify(helperPath)};
    const cases = [
      pronunciationWriteError("listen", "permission denied for table tenants"),
      pronunciationWriteError(
        "review",
        "permission denied for column pronunciation_review_queue"
      ),
      pronunciationWriteError("listen", "Could not save the listen."),
      pronunciationWriteError(
        "listen",
        "column pronunciation_review_queue does not exist"
      ),
      pronunciationWriteError("listen", "Gemini HTTP 429: quota"),
      pronunciationWriteError("review", "GEMINI_API_KEY is not configured"),
    ];
    console.log(JSON.stringify(cases));
  `;
  const ran = spawnSync(
    process.execPath,
    ["--experimental-strip-types", "--input-type=module", "-e", script],
    { encoding: "utf8" }
  );
  assert.equal(ran.status, 0, ran.stderr || ran.stdout);
  return JSON.parse(ran.stdout.trim().split("\n").at(-1));
}

test("permission denied on a listen save names the listen, not the empty queue", () => {
  const [listenDenied, reviewDenied, passthrough, missingColumn, providerListen, providerReview] =
    loadWriteError();
  assert.equal(listenDenied, "Could not save the listen.");
  assert.equal(reviewDenied, "Could not save the review.");
  assert.equal(passthrough, "Could not save the listen.");
  assert.equal(missingColumn, "Could not save the listen.");
  assert.equal(providerListen, "Could not save the listen.");
  assert.equal(providerReview, "Could not save the review.");
  assert.doesNotMatch(listenDenied, /pronunciation review/);
  assert.doesNotMatch(providerListen, /gemini/i);
  assert.doesNotMatch(providerReview, /GEMINI_API_KEY/);
  assert.doesNotMatch(listenDenied, /[—–]/);
});

test("opening Fix loads the queue and does not return a save failure", () => {
  const src = fs.readFileSync(actionPath, "utf8");
  const loadStart = src.indexOf("export async function loadPronunciationReviewQueueAction");
  const loadEnd = src.indexOf("export async function geminiScanRecentCallsAction");
  assert.ok(loadStart >= 0 && loadEnd > loadStart);
  const load = src.slice(loadStart, loadEnd);
  assert.match(load, /readQueueFields/);
  assert.match(load, /Could not load review/);
  assert.doesNotMatch(load, /Could not save/);
  assert.doesNotMatch(load, /\.update\(/);

  const scanStart = src.indexOf("async function runGeminiScanRecentCalls");
  const scanEnd = src.indexOf("export async function approveGeminiScanCandidateAction");
  const scan = src.slice(scanStart, scanEnd);
  assert.match(scan, /pronunciationWriteError\("listen"/);
  assert.doesNotMatch(scan, /Could not save pronunciation review/);
  assert.match(scan, /Listen to the last \$\{batchSize\} recordings\./);
  assert.match(scan, /Listen is unavailable/);
  assert.match(scan, /Could not listen/);
  assert.match(scan, /No recordings to listen to/);
  assert.match(scan, /listenWalkLimit/);
  assert.match(scan, /listenAddedCopy/);
  assert.match(scan, /unsaved: true/);
  assert.doesNotMatch(scan, /left for review/);
  const saveOnlyAt = scan.indexOf('save_only');
  const rateAt = scan.indexOf("rateLimitScan");
  assert.ok(saveOnlyAt >= 0 && rateAt > saveOnlyAt);

  const saveFn = src.slice(
    src.indexOf("async function saveHeldReviewQueue"),
    src.indexOf("export async function loadPronunciationReviewQueueAction")
  );
  assert.match(saveFn, /parseReviewQueue/);
  assert.doesNotMatch(saveFn, /rateLimitScan/);
  assert.doesNotMatch(saveFn, /scanCallsWithGemini/);
  assert.doesNotMatch(saveFn, /tts_lexicon/);
  assert.doesNotMatch(src, /This is paid/);
  assert.doesNotMatch(src, /paid API/);
  assert.doesNotMatch(src, /Gemini Scan/);
  assert.doesNotMatch(src, /Ask support/);
  assert.match(src, /Wait a few minutes/);
  assert.match(src, /Could not load review/);
  assert.match(src, /pronunciationWriteError\("review"/);
});
