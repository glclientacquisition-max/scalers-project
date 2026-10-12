#!/usr/bin/env node
/**
 * Rebuild the staging branch as main plus every open pull request.
 * A pull request into another feature branch is included. Closing one runs
 * this again, so that change leaves staging.
 *
 * Label skip-staging on an open pull request excludes it from the rebuild.
 * Use that to keep a curated staging tip without closing the PR. hold-staging
 * still freezes the rebuild entirely (see stage-pull-request-hold.js).
 *
 * The workflow checks out main and runs this file. It fetches pull request
 * refs and merges those refs. It does not execute files from the pull requests.
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

const SKIP_STAGING_LABEL = "skip-staging";

function rowHasLabel(row, name) {
  const labels = row && row.labels;
  if (!Array.isArray(labels)) return false;
  return labels.some((label) => {
    if (typeof label === "string") return label === name;
    return Boolean(label && label.name === name);
  });
}

function selectStagingPulls(rows, { stagingBranch = STAGING_BRANCH } = {}) {
  return (Array.isArray(rows) ? rows : [])
    .filter(
      (row) =>
        row &&
        row.headRefName !== stagingBranch &&
        row.baseRefName !== stagingBranch &&
        !rowHasLabel(row, SKIP_STAGING_LABEL)
    )
    .map((row) => Number(row.number))
    .filter((number) => Number.isInteger(number) && number > 0)
    .sort((a, b) => b - a);
}

function listOpenPullNumbers({ repo, stagingBranch = STAGING_BRANCH } = {}) {
  if (!repo) throw new Error("GITHUB_REPOSITORY is required to list open pull requests");
  const raw = execFileSync(
    "gh",
    [
      "pr",
      "list",
      "--repo",
      repo,
      "--state",
      "open",
      "--limit",
      "200",
      "--json",
      "number,headRefName,baseRefName,labels",
    ],
    { encoding: "utf8" }
  );
  return selectStagingPulls(JSON.parse(raw), { stagingBranch });
}

function rebuildStaging({
  cwd,
  prNumbers,
  stagingBranch = STAGING_BRANCH,
  remote = "origin",
}) {
  if (!Array.isArray(prNumbers)) throw new Error("prNumbers is required");

  runGit(cwd, ["fetch", remote, "main", stagingBranch]);
  const expected = runGit(cwd, ["rev-parse", `${remote}/${stagingBranch}`]).stdout.trim();
  runGit(cwd, ["checkout", "-B", "staging-work", `${remote}/main`]);
  runGit(cwd, ["config", "user.email", "github-actions[bot]@users.noreply.github.com"]);
  runGit(cwd, ["config", "user.name", "github-actions[bot]"]);

  const included = [];
  const conflicts = [];
  const newestFirst = [...prNumbers].map(Number).sort((a, b) => b - a);

  for (const number of newestFirst) {
    const ref = `pr-${number}`;
    runGit(cwd, ["fetch", remote, `+pull/${number}/head:${ref}`]);
    const merged = runGit(
      cwd,
      ["merge", "--no-ff", "--no-edit", ref, "-m", `chore: stage PR #${number} for testing`],
      { allowFail: true }
    );
    if (merged.code !== 0) {
      const detail = `${merged.stdout}\n${merged.stderr}`.trim();
      runGit(cwd, ["merge", "--abort"], { allowFail: true });
      if (/CONFLICT|could not apply|Automatic merge failed|fix conflicts/i.test(detail)) {
        conflicts.push({ number, detail });
        continue;
      }
      throw new Error(detail);
    }
    included.push(number);
  }

  const newTree = runGit(cwd, ["rev-parse", "HEAD^{tree}"]).stdout.trim();
  const oldTree = runGit(cwd, ["rev-parse", `${expected}^{tree}`]).stdout.trim();
  if (newTree === oldTree) {
    return { status: "current", stagingSha: expected, included, conflicts };
  }

  runGit(cwd, [
    "push",
    `--force-with-lease=refs/heads/${stagingBranch}:${expected}`,
    remote,
    `HEAD:refs/heads/${stagingBranch}`,
  ]);
  const stagingSha = runGit(cwd, ["rev-parse", "HEAD"]).stdout.trim();
  return { status: "rebuilt", stagingSha, included, conflicts };
}

function statusForPull(result, number, { merged = false } = {}) {
  const n = Number(number);
  if (merged) return "on-main";
  if ((result.conflicts || []).some((conflict) => Number(conflict.number) === n)) return "conflict";
  if ((result.included || []).map(Number).includes(n)) return "on-staging";
  return "removed";
}

function noteBody(status, stagingSha) {
  const tip = stagingSha ? ["", `Staging branch tip: \`${stagingSha}\`.`] : [];
  if (status === "conflict") {
    return [
      NOTE_MARKER,
      "This pull request is off staging. It conflicted with main or another open pull request.",
      "",
      "Update the branch and push. This check will try again.",
      "",
      `Staging desk: ${STAGING_DESK_URL}`,
      ...tip,
    ].join("\n");
  }
  if (status === "removed") {
    return [
      NOTE_MARKER,
      "This pull request is off the staging branch.",
      "",
      "Staging is main plus the pull requests still open, including one that targets another feature branch.",
      "",
      `Staging desk: ${STAGING_DESK_URL}`,
      ...tip,
    ].join("\n");
  }
  if (status === "on-main") {
    return [
      NOTE_MARKER,
      "This pull request is in main. Staging includes it from main.",
      "",
      "Production follows main.",
      "",
      `Staging desk: ${STAGING_DESK_URL}`,
      ...tip,
    ].join("\n");
  }
  return [
    NOTE_MARKER,
    "This pull request is on the staging branch.",
    "",
    "Closing it takes it off. Production updates when it merges into main.",
    "",
    `Staging desk: ${STAGING_DESK_URL}`,
    `Staging voice: ${STAGING_VOICE_HEALTH_URL}`,
    ...tip,
  ].join("\n");
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
    return { state: "failure", description: "Staging merge conflicted" };
  }
  if (result.status === "removed") {
    return { state: "success", description: "Off the staging branch" };
  }
  return { state: "success", description: "On the staging branch" };
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
  if (process.env.PR_EVENT && decision.action === "skip") {
    writeResult(resultPath, { status: "skipped", reason: decision.reason, included: [], conflicts: [] });
    return;
  }

  const prNumbers = process.env.PR_NUMBERS
    ? process.env.PR_NUMBERS.split(",").filter(Boolean).map(Number)
    : listOpenPullNumbers({ repo: process.env.GITHUB_REPOSITORY });

  const rebuilt = rebuildStaging({ cwd: process.cwd(), prNumbers });
  const trigger = process.env.PR_NUMBER ? Number(process.env.PR_NUMBER) : null;
  const merged = process.env.PR_MERGED === "true";
  const status = trigger
    ? statusForPull(rebuilt, trigger, { merged })
    : rebuilt.status;
  writeResult(resultPath, { ...rebuilt, status });
  if (status === "conflict") process.exitCode = 2;
}

if (require.main === module) main();

module.exports = {
  STAGING_BRANCH,
  SKIP_STAGING_LABEL,
  STAGING_DESK_URL,
  NOTE_MARKER,
  decideStage,
  selectStagingPulls,
  listOpenPullNumbers,
  rebuildStaging,
  statusForPull,
  noteBody,
  noteRequest,
  statusFor,
  readResult,
  writeResult,
};
