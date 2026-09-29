#!/usr/bin/env node
/**
 * Post one staging note on the pull request and set a commit status.
 * Reads the JSON result written by scripts/stage-pull-request.js.
 */
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const { noteBody, noteRequest, statusFor, readResult, STAGING_DESK_URL } = require("./stage-pull-request");

function gh(args, payload) {
  return execFileSync("gh", args, {
    encoding: "utf8",
    input: payload ? JSON.stringify(payload) : undefined,
  });
}

function main() {
  const resultPath = process.env.STAGE_RESULT_PATH || "/tmp/stage-result.json";
  if (!fs.existsSync(resultPath)) {
    throw new Error(`Missing stage result at ${resultPath}`);
  }
  const result = readResult(resultPath);
  if (result.status === "skipped") return;

  const repo = process.env.GITHUB_REPOSITORY;
  const prNumber = process.env.PR_NUMBER;
  const sha = process.env.PR_HEAD_SHA;
  if (!repo || !prNumber) throw new Error("GITHUB_REPOSITORY and PR_NUMBER are required");

  const body = noteBody(result.status, result.stagingSha);
  const status = statusFor(result);
  if (sha) {
    gh(
      ["api", "--method", "POST", `repos/${repo}/statuses/${sha}`, "--input", "-"],
      {
        state: status.state,
        context: "staging",
        description: status.description,
        target_url: STAGING_DESK_URL,
      }
    );
  }

  const comments = JSON.parse(
    gh(["api", `repos/${repo}/issues/${prNumber}/comments?per_page=100`])
  );
  const action = noteRequest(comments, body);
  if (action.method === "PATCH") {
    gh(
      ["api", "--method", "PATCH", `repos/${repo}/issues/comments/${action.id}`, "--input", "-"],
      { body }
    );
  } else {
    gh(
      ["api", "--method", "POST", `repos/${repo}/issues/${prNumber}/comments`, "--input", "-"],
      { body }
    );
  }
}

if (require.main === module) main();
