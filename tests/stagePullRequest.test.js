const { describe, it, after } = require("node:test");
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  STAGING_BRANCH,
  decideStage,
  stagePullRequest,
  noteBody,
  noteRequest,
  statusFor,
} = require("../scripts/stage-pull-request");

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
  git(work, ["init", "--bare", remote]);
  git(work, ["remote", "add", "origin", remote]);
  git(work, ["checkout", "-b", STAGING_BRANCH]);
  writeCommit(work, "staging-only.txt", "keep\n", "staging only");
  git(work, ["checkout", "main"]);
  git(work, ["checkout", "-b", "feature"]);
  writeCommit(work, "feature.txt", "hello\n", "feature");
  const featureSha = git(work, ["rev-parse", "HEAD"]).trim();
  git(work, ["push", "origin", "main", STAGING_BRANCH, "feature"]);
  git(work, ["push", "origin", "feature:refs/pull/7/head"]);
  git(work, ["checkout", "main"]);
  return { work, remote, featureSha };
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

describe("stagePullRequest", () => {
  it("merges the pull request onto staging and keeps staging-only commits", () => {
    const { work, remote } = setupRepo();
    const first = stagePullRequest({ cwd: work, prNumber: 7 });
    assert.equal(first.status, "merged");
    assert.match(remoteFile(remote, STAGING_BRANCH, "feature.txt"), /hello/);
    assert.match(remoteFile(remote, STAGING_BRANCH, "staging-only.txt"), /keep/);

    const second = stagePullRequest({ cwd: work, prNumber: 7 });
    assert.equal(second.status, "current");
    assert.equal(second.stagingSha, first.stagingSha);
  });

  it("leaves staging unchanged when the merge conflicts", () => {
    const { work, remote } = setupRepo();
    git(work, ["checkout", STAGING_BRANCH]);
    writeCommit(work, "README", "staging\n", "staging readme");
    git(work, ["push", "origin", STAGING_BRANCH]);
    git(work, ["checkout", "feature"]);
    writeCommit(work, "README", "feature\n", "feature readme");
    git(work, ["push", "origin", "feature:refs/pull/7/head"]);
    git(work, ["checkout", "main"]);

    const result = stagePullRequest({ cwd: work, prNumber: 7 });
    assert.equal(result.status, "conflict");
    assert.match(remoteFile(remote, STAGING_BRANCH, "README"), /staging/);
    assert.throws(() => remoteFile(remote, STAGING_BRANCH, "feature.txt"));
  });
});

describe("pull request note", () => {
  it("posts once, then updates the same comment", () => {
    const body = noteBody("merged", "abc123");
    assert.match(body, /scalers-staging\.vercel\.app/);
    assert.match(body, /abc123/);
    const created = noteRequest([], body);
    assert.equal(created.method, "POST");
    const updated = noteRequest([{ id: 9, body }], noteBody("current", "abc123"));
    assert.equal(updated.method, "PATCH");
    assert.equal(updated.id, 9);
  });

  it("marks a conflict as a failed status", () => {
    assert.equal(statusFor({ status: "conflict" }).state, "failure");
    assert.equal(statusFor({ status: "merged" }).state, "success");
    assert.match(noteBody("conflict"), /conflicted/);
  });
});

after(() => {
  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true });
});
