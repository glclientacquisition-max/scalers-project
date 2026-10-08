const { describe, it, after } = require("node:test");
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  STAGING_BRANCH,
  decideStage,
  selectStagingPulls,
  rebuildStaging,
  noteBody,
  noteRequest,
  statusFor,
  statusForPull,
} = require("../scripts/stage-pull-request");
const { noteTargets } = require("../scripts/stage-pull-request-note");

const tempDirs = [];

function git(cwd, args) {
  return execFileSync("git", args, { cwd, encoding: "utf8" });
}

function writeCommit(cwd, file, contents, message) {
  fs.writeFileSync(path.join(cwd, file), contents);
  git(cwd, ["add", file]);
  git(cwd, ["commit", "-m", message]);
}

function setupRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "stage-pr-"));
  tempDirs.push(dir);
  const remote = path.join(dir, "remote.git");
  const work = path.join(dir, "work");
  fs.mkdirSync(work);
  git(work, ["init", "-b", "main"]);
  git(work, ["config", "user.email", "test@example.com"]);
  git(work, ["config", "user.name", "test"]);
  writeCommit(work, "README", "main\n", "init");
  git(work, ["init", "--bare", "-b", "main", remote]);
  git(work, ["remote", "add", "origin", remote]);
  git(work, ["checkout", "-b", STAGING_BRANCH]);
  writeCommit(work, "staging-only.txt", "keep\n", "staging only");
  git(work, ["push", "origin", "main", STAGING_BRANCH]);
  git(work, ["checkout", "main"]);
  return { work, remote };
}

function addPull(work, number, file, contents) {
  git(work, ["checkout", "main"]);
  git(work, ["checkout", "-B", `feature-${number}`]);
  writeCommit(work, file, contents, `pr ${number}`);
  git(work, ["push", "origin", `feature-${number}:refs/pull/${number}/head`]);
  git(work, ["checkout", "main"]);
}

function remoteFile(remote, branch, file) {
  return git(remote, ["show", `${branch}:${file}`]);
}

describe("decideStage", () => {
  it("merges a same-repo pull request", () => {
    assert.deepEqual(
      decideStage({
        headRepo: "glclientacquisition-max/scalers-project",
        baseRepo: "glclientacquisition-max/scalers-project",
        headRef: "cursor/desk-copy-cb6a",
      }),
      { action: "merge" }
    );
  });

  it("skips a fork", () => {
    assert.equal(
      decideStage({
        headRepo: "other/scalers-project",
        baseRepo: "glclientacquisition-max/scalers-project",
        headRef: "cursor/desk-copy-cb6a",
      }).action,
      "skip"
    );
  });

  it("skips the staging branch itself", () => {
    assert.equal(
      decideStage({
        headRepo: "glclientacquisition-max/scalers-project",
        baseRepo: "glclientacquisition-max/scalers-project",
        headRef: STAGING_BRANCH,
      }).reason,
      "staging-branch"
    );
  });
});

describe("selectStagingPulls", () => {
  it("includes a pull request into main and one into another feature branch", () => {
    const numbers = selectStagingPulls([
      { number: 10, headRefName: "cursor/older", baseRefName: "main" },
      { number: 12, headRefName: "cursor/stacked", baseRefName: "cursor/older" },
      { number: 11, headRefName: STAGING_BRANCH, baseRefName: "main" },
      { number: 9, headRefName: "cursor/into-staging", baseRefName: STAGING_BRANCH },
    ]);
    assert.deepEqual(numbers, [12, 10]);
  });

  it("excludes a pull request labeled skip-staging and keeps one without the label", () => {
    const numbers = selectStagingPulls([
      {
        number: 14,
        headRefName: "cursor/phase2",
        baseRefName: "main",
        labels: [{ name: "skip-staging" }],
      },
      {
        number: 12,
        headRefName: "cursor/m0-coverage",
        baseRefName: "main",
        labels: [{ name: "voice" }],
      },
      {
        number: 11,
        headRefName: STAGING_BRANCH,
        baseRefName: "main",
        labels: [],
      },
      {
        number: 10,
        headRefName: "cursor/into-staging",
        baseRefName: STAGING_BRANCH,
        labels: [{ name: "skip-staging" }],
      },
    ]);
    assert.deepEqual(numbers, [12]);
  });
});

describe("rebuildStaging", () => {
  it("rebuilds staging as main plus open pull requests", () => {
    const { work, remote } = setupRepo();
    addPull(work, 7, "feature.txt", "hello\n");

    const first = rebuildStaging({ cwd: work, prNumbers: [7] });
    assert.equal(first.status, "rebuilt");
    assert.deepEqual(first.included, [7]);
    assert.match(remoteFile(remote, STAGING_BRANCH, "feature.txt"), /hello/);
    assert.throws(() => remoteFile(remote, STAGING_BRANCH, "staging-only.txt"));

    const second = rebuildStaging({ cwd: work, prNumbers: [7] });
    assert.equal(second.status, "current");
    assert.equal(second.stagingSha, first.stagingSha);
  });

  it("drops a pull request that is no longer open", () => {
    const { work, remote } = setupRepo();
    addPull(work, 7, "feature.txt", "hello\n");
    rebuildStaging({ cwd: work, prNumbers: [7] });

    const cleared = rebuildStaging({ cwd: work, prNumbers: [] });
    assert.equal(cleared.status, "rebuilt");
    assert.deepEqual(cleared.included, []);
    assert.throws(() => remoteFile(remote, STAGING_BRANCH, "feature.txt"));
    assert.match(remoteFile(remote, STAGING_BRANCH, "README"), /main/);
  });

  it("keeps the newer pull request when an older one conflicts", () => {
    const { work, remote } = setupRepo();
    addPull(work, 7, "README", "older\n");
    addPull(work, 8, "README", "newer\n");

    const result = rebuildStaging({ cwd: work, prNumbers: [7, 8] });
    assert.deepEqual(result.included, [8]);
    assert.equal(result.conflicts[0].number, 7);
    assert.match(remoteFile(remote, STAGING_BRANCH, "README"), /newer/);
  });
});

describe("pull request note", () => {
  it("posts once, then updates the same comment", () => {
    const body = noteBody("on-staging", "abc123");
    assert.match(body, /scalers-staging\.vercel\.app/);
    assert.match(body, /Closing it takes it off/);
    assert.match(body, /abc123/);
    const created = noteRequest([], body);
    assert.equal(created.method, "POST");
    const updated = noteRequest([{ id: 9, body }], noteBody("removed", "abc123"));
    assert.equal(updated.method, "PATCH");
    assert.equal(updated.id, 9);
    assert.match(updated.body, /off the staging branch/);
  });

  it("marks a conflict as a failed status and a closed pull request as removed", () => {
    const result = { included: [8], conflicts: [{ number: 7 }] };
    assert.equal(statusForPull(result, 8), "on-staging");
    assert.equal(statusForPull(result, 7), "conflict");
    assert.equal(statusForPull(result, 7, { merged: true }), "on-main");
    assert.equal(statusForPull(result, 3), "removed");
    assert.equal(statusFor({ status: "conflict" }).state, "failure");
    assert.equal(statusFor({ status: "removed" }).state, "success");
    assert.match(noteBody("conflict"), /conflicted/);
  });

  it("notes the triggering pull request and every included or conflicting one", () => {
    assert.deepEqual(
      noteTargets({ included: [8, 9], conflicts: [{ number: 7 }] }, 9),
      [9, 8, 7]
    );
  });
});

after(() => {
  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true });
});
