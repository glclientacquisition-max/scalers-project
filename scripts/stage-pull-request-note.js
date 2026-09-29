#!/usr/bin/env node
/**
 * Post one staging note per affected pull request and set a status on the
 * pull request that triggered this run.
 */
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const {
  noteBody,
  noteRequest,
  statusFor,
  statusForPull,
  readResult,
  STAGING_DESK_URL,
} = require("./stage-pull-request");

function gh(args, payload) {
  return execFileSync("gh", args, {
    encoding: "utf8",
    input: payload ? JSON.stringify(payload) : undefined,
  });
}

function noteTargets(result, trigger) {
  const targets = new Set();
  if (trigger) targets.add(Number(trigger));
  for (const number of result.included || []) targets.add(Number(number));
  for (const conflict of result.conflicts || []) targets.add(Number(conflict.number));
  return [...targets];
}

function main() {
  const resultPath = process.env.STAGE_RESULT_PATH || "/tmp/stage-result.json";
  if (!fs.existsSync(resultPath)) {
    throw new Error(`Missing stage result at ${resultPath}`);
  }
  const result = readResult(resultPath);
  if (result.status === "skipped") return;

  const repo = process.env.GITHUB_REPOSITORY;
  if (!repo) throw new Error("GITHUB_REPOSITORY is required");
  const trigger = process.env.PR_NUMBER ? Number(process.env.PR_NUMBER) : null;
  const merged = process.env.PR_MERGED === "true";
  const targets = noteTargets(result, trigger);

  for (const number of targets) {
    const statusName = statusForPull(result, number, { merged: merged && number === trigger });
    const body = noteBody(statusName, result.stagingSha);
    const comments = JSON.parse(
      gh(["api", `repos/${repo}/issues/${number}/comments?per_page=100`])
    );
    const action = noteRequest(comments, body);
    if (action.method === "PATCH") {
      gh(
        ["api", "--method", "PATCH", `repos/${repo}/issues/comments/${action.id}`, "--input", "-"],
        { body }
      );
    } else {
      gh(
        ["api", "--method", "POST", `repos/${repo}/issues/${number}/comments`, "--input", "-"],
        { body }
      );
    }
    if (trigger && number === trigger && process.env.PR_HEAD_SHA) {
      const status = statusFor({ status: statusName });
      gh(
        ["api", "--method", "POST", `repos/${repo}/statuses/${process.env.PR_HEAD_SHA}`, "--input", "-"],
        {
          state: status.state,
          context: "staging",
          description: status.description,
          target_url: STAGING_DESK_URL,
        }
      );
    }
  }
}

if (require.main === module) main();

module.exports = { noteTargets };
