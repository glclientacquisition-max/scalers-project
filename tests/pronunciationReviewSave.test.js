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
  const [listenDenied, reviewDenied, passthrough, missingColumn] = loadWriteError();
  assert.equal(listenDenied, "Could not save the listen.");
  assert.equal(reviewDenied, "Could not save the review.");
  assert.equal(passthrough, "Could not save the listen.");
  assert.equal(missingColumn, "Could not save the listen.");
  assert.doesNotMatch(listenDenied, /pronunciation review/);
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
});
