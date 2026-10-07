#!/usr/bin/env node
/**
 * Decide whether Stage-PR must leave Railway staging Voice where it is.
 *
 * Two things move that service today:
 * 1. The rebuild force-pushes cursor/staging-voice-468b. Railway autodeploys
 *    pushes to the connected branch.
 * 2. After that push, the workflow calls serviceConnect with the branch and
 *    no commit SHA. A commit pin ignores later pushes, so this call is what
 *    clears the pin and makes Voice follow the branch again.
 *
 * A hold skips both. The next run with no hold rebuilds and connects as usual.
 */
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");

const { STAGING_BRANCH } = require("./stage-pull-request");

const HOLD_LABEL = "hold-staging";
const TRUTHY_HOLD = new Set(["1", "true", "on"]);

function normalizeHoldVariable(raw) {
  return String(raw ?? "").replace(/[\r\n]+/g, "").trim();
}

function isTruthyHold(raw) {
  return TRUTHY_HOLD.has(normalizeHoldVariable(raw).toLowerCase());
}

function labeledPullNumbers(rows) {
  const seen = new Set();
  for (const row of Array.isArray(rows) ? rows : []) {
    const number = Number(row && row.number);
    if (Number.isInteger(number) && number > 0) seen.add(number);
  }
  return [...seen].sort((a, b) => a - b);
}

function stagePrHoldNotice({ variable, pullNumbers }) {
  const reasons = [];
  const shown = normalizeHoldVariable(variable);
  if (isTruthyHold(shown)) reasons.push(`STAGE_PR_HOLD=${shown}`);
  const pulls = labeledPullNumbers(pullNumbers);
  if (pulls.length) {
    reasons.push(`label ${HOLD_LABEL} on ${pulls.map((number) => `#${number}`).join(", ")}`);
  }
  if (!reasons.length) return null;
  return `Stage-PR hold active (${reasons.join(" / ")}): skipping staging re-point`;
}

function errorText(error) {
  return [error && error.stdout, error && error.stderr, error && error.message]
    .map((part) => (Buffer.isBuffer(part) ? part.toString("utf8") : String(part || "")))
    .join("\n");
}

function isMissingHoldLabel(text) {
  const body = String(text || "");
  if (!new RegExp(HOLD_LABEL, "i").test(body)) return false;
  return /not found|does not exist|could not resolve|unknown label|no such label|404/i.test(body);
}

function listHoldStagingPulls({ repo, exec = execFileSync } = {}) {
  if (!repo) throw new Error("GITHUB_REPOSITORY is required to check hold-staging");
  const raw = exec(
    "gh",
    [
      "pr",
      "list",
      "--repo",
      repo,
      "--state",
      "open",
      "--label",
      HOLD_LABEL,
      "--limit",
      "200",
      "--json",
      "number",
    ],
    { encoding: "utf8" }
  );
  const parsed = JSON.parse(raw || "[]");
  return labeledPullNumbers(parsed);
}

function writeOutput(outputPath, hold) {
  if (!outputPath) return;
  fs.appendFileSync(outputPath, `hold=${hold ? "true" : "false"}\n`);
}

function writeSummary(summaryPath, text) {
  if (!summaryPath || !text) return;
  fs.appendFileSync(summaryPath, text.endsWith("\n") ? text : `${text}\n`);
}

function runHoldCheck({
  variable = process.env.STAGE_PR_HOLD,
  repo = process.env.GITHUB_REPOSITORY,
  exec = execFileSync,
  outputPath = process.env.GITHUB_OUTPUT,
  summaryPath = process.env.GITHUB_STEP_SUMMARY,
  log = console.log,
} = {}) {
  let pulls = [];
  let labelWarning = "";
  try {
    pulls = listHoldStagingPulls({ repo, exec });
  } catch (error) {
    const detail = errorText(error);
    if (isMissingHoldLabel(detail)) {
      pulls = [];
    } else if (isTruthyHold(variable)) {
      labelWarning = "Stage-PR hold could not list hold-staging labels; variable hold still skips the re-point";
      pulls = [];
    } else {
      throw new Error(`Stage-PR hold could not list open pull requests: ${detail}`.trim());
    }
  }

  const sentence = stagePrHoldNotice({ variable, pullNumbers: pulls.map((number) => ({ number })) });
  const hold = Boolean(sentence);
  writeOutput(outputPath, hold);
  if (sentence) {
    log(`::notice::${sentence}`);
    writeSummary(summaryPath, `${sentence}\nBranch ${STAGING_BRANCH} was not pushed.\n`);
  } else {
    log("Stage-PR hold inactive");
  }
  if (labelWarning) log(`::warning::${labelWarning}`);
  return { hold, sentence };
}

function main() {
  runHoldCheck();
}

if (require.main === module) main();

module.exports = {
  HOLD_LABEL,
  STAGING_BRANCH,
  normalizeHoldVariable,
  isTruthyHold,
  labeledPullNumbers,
  stagePrHoldNotice,
  isMissingHoldLabel,
  listHoldStagingPulls,
  runHoldCheck,
};
