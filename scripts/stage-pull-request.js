#!/usr/bin/env node
/**
 * Merge a pull request onto the staging branch so Desk and Voice can deploy it
 * before that pull request merges to main.
 *
 * The workflow checks out main and runs this file. It fetches the pull request
 * ref and merges that ref. It does not execute files from the pull request.
 */
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");

const STAGING_BRANCH = "cursor/staging-voice-468b";
const NOTE_MARKER = "<!-- staging-auto -->";
const STAGING_DESK_URL = "https://scalers-staging.vercel.app";
const STAGING_VOICE_HEALTH_URL = "https://scalers-staging-staging.up.railway.app/healthz";

function decideStage({ headRepo, baseRepo, headRef, stagingBranch = STAGING_BRANCH }) {
  if (!headRepo || !baseRepo || headRepo !== baseRepo) {
    return { action: "skip", reason: "fork" };
  }
  if (headRef === stagingBranch) {
    return { action: "skip", reason: "staging-branch" };
  }
  return { action: "merge" };
}

function runGit(cwd, args, { allowFail = false } = {}) {
  try {
    const stdout = execFileSync("git", ["-c", "core.hooksPath=/dev/null", ...args], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { code: 0, stdout, stderr: "" };
  } catch (error) {
    const stdout = error.stdout?.toString() ?? "";
    const stderr = error.stderr?.toString() ?? "";
    if (allowFail) return { code: error.status ?? 1, stdout, stderr };
    const wrapped = new Error(`git ${args.join(" ")} failed: ${stderr || stdout}`.trim());
    wrapped.stdout = stdout;
    wrapped.stderr = stderr;
    throw wrapped;
  }
}

function stagePullRequest({
  cwd,
  prNumber,
  stagingBranch = STAGING_BRANCH,
  remote = "origin",
}) {
  if (!prNumber) throw new Error("PR_NUMBER is required");

  runGit(cwd, ["fetch", remote, stagingBranch]);
  runGit(cwd, ["fetch", remote, `+pull/${prNumber}/head:pr-head`]);
  runGit(cwd, ["checkout", "-B", "staging-work", `${remote}/${stagingBranch}`]);
  runGit(cwd, ["config", "user.email", "github-actions[bot]@users.noreply.github.com"]);
  runGit(cwd, ["config", "user.name", "github-actions[bot]"]);

  const ancestor = runGit(cwd, ["merge-base", "--is-ancestor", "pr-head", "HEAD"], {
    allowFail: true,
  });
  if (ancestor.code === 0) {
    const stagingSha = runGit(cwd, ["rev-parse", "HEAD"]).stdout.trim();
    return { status: "current", stagingSha };
  }

  const merged = runGit(
    cwd,
    ["merge", "--no-ff", "--no-edit", "pr-head", "-m", `chore: stage PR #${prNumber} for testing`],
    { allowFail: true }
  );
  if (merged.code !== 0) {
    const detail = `${merged.stdout}\n${merged.stderr}`.trim();
    runGit(cwd, ["merge", "--abort"], { allowFail: true });
    if (/CONFLICT|could not apply|Automatic merge failed|fix conflicts/i.test(detail)) {
      return { status: "conflict", detail };
    }
    throw new Error(detail);
  }

  runGit(cwd, ["push", remote, `HEAD:${stagingBranch}`]);
  const stagingSha = runGit(cwd, ["rev-parse", "HEAD"]).stdout.trim();
  return { status: "merged", stagingSha };
}

function noteBody(status, stagingSha) {
  if (status === "conflict") {
    return [
      NOTE_MARKER,
      "This pull request did not land on staging. The merge into `cursor/staging-voice-468b` conflicted.",
      "",
      "Update the branch so it merges cleanly, push, and this check will try again.",
      "",
      `Staging desk: ${STAGING_DESK_URL}`,
    ].join("\n");
  }
  const lines = [
    NOTE_MARKER,
    "This pull request is on the staging branch `cursor/staging-voice-468b`.",
    "",
    `Staging desk: ${STAGING_DESK_URL}`,
    `Staging voice: ${STAGING_VOICE_HEALTH_URL}`,
    "",
    "Production updates when this pull request merges into `main`.",
  ];
  if (stagingSha) lines.push("", `Staging branch tip: \`${stagingSha}\`.`);
  return lines.join("\n");
}

function noteRequest(comments, body) {
  const existing = (comments || []).find(
    (comment) => typeof comment.body === "string" && comment.body.includes(NOTE_MARKER)
  );
  if (existing) return { method: "PATCH", id: existing.id, body };
  return { method: "POST", body };
}

function statusFor(result) {
  if (result.status === "conflict") {
    return {
      state: "failure",
      description: "Merge into staging conflicted",
    };
  }
  return {
    state: "success",
    description: "On the staging branch",
  };
}

function readResult(resultPath) {
  return JSON.parse(fs.readFileSync(resultPath, "utf8"));
}

function writeResult(resultPath, result) {
  fs.writeFileSync(resultPath, JSON.stringify(result));
}

function main() {
  const resultPath = process.env.STAGE_RESULT_PATH || "/tmp/stage-result.json";
  const decision = decideStage({
    headRepo: process.env.HEAD_REPO || process.env.GITHUB_REPOSITORY,
    baseRepo: process.env.BASE_REPO || process.env.GITHUB_REPOSITORY,
    headRef: process.env.HEAD_REF,
  });
  if (decision.action === "skip") {
    writeResult(resultPath, { status: "skipped", reason: decision.reason });
    return;
  }
  const result = stagePullRequest({
    cwd: process.cwd(),
    prNumber: process.env.PR_NUMBER,
  });
  writeResult(resultPath, result);
  if (result.status === "conflict") process.exitCode = 2;
}

if (require.main === module) main();

module.exports = {
  STAGING_BRANCH,
  STAGING_DESK_URL,
  NOTE_MARKER,
  decideStage,
  stagePullRequest,
  noteBody,
  noteRequest,
  statusFor,
  readResult,
  writeResult,
};
