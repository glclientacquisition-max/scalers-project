// dashboard/scripts/vercel-ignore-build.sh: exit 0 skips a Vercel build, exit 1 builds.
const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync, execFileSync } = require("node:child_process");

const SCRIPT = path.join(__dirname, "..", "dashboard", "scripts", "vercel-ignore-build.sh");
const STAGING = "prj_koYxAaXjOZ9QYA7hVB2SUOEAmyoB";
const PROD = "prj_GYOgX3yjVowvQ1hd7D1c0AWOovpx";
const STAGING_BRANCH = "cursor/staging-voice-468b";

let repo;
const shas = {};

function git(...args) {
  return execFileSync("git", args, { cwd: repo, encoding: "utf8" }).trim();
}

function commit(file, label) {
  const full = path.join(repo, file);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.appendFileSync(full, `${label}\n`);
  git("add", "-A");
  git("commit", "-q", "-m", label);
  return git("rev-parse", "HEAD");
}

function run(env) {
  const result = spawnSync("bash", [SCRIPT], {
    cwd: path.join(repo, "dashboard"),
    encoding: "utf8",
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME || os.tmpdir(),
      ...env,
    },
  });
  return { status: result.status, out: `${result.stdout}${result.stderr}` };
}

before(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), "vercel-ignore-"));
  git("init", "-q", "-b", "main");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "test");
  shas.root = commit("dashboard/package.json", "root");
  shas.desk = commit("dashboard/src/app/page.tsx", "desk change");
  shas.voice = commit("src/speech/sonioxStt.js", "voice change");
  shas.docs = commit("docs/operations/ENVIRONMENTS.md", "docs change");
});

after(() => {
  fs.rmSync(repo, { recursive: true, force: true });
});

describe("vercel-ignore-build.sh on scalers-project (prod Desk)", () => {
  const base = { VERCEL_PROJECT_ID: PROD, VERCEL_ENV: "preview", VERCEL_GIT_COMMIT_REF: "cursor/x" };

  it("skips a voice-only range", () => {
    const r = run({ ...base, VERCEL_GIT_PREVIOUS_SHA: shas.desk, VERCEL_GIT_COMMIT_SHA: shas.voice });
    assert.equal(r.status, 0, r.out);
    assert.match(r.out, /SKIP/);
  });

  it("builds a range that touches dashboard/", () => {
    const r = run({ ...base, VERCEL_GIT_PREVIOUS_SHA: shas.root, VERCEL_GIT_COMMIT_SHA: shas.docs });
    assert.equal(r.status, 1, r.out);
    assert.match(r.out, /BUILD/);
  });

  it("always builds production, even with no Desk change", () => {
    const r = run({
      ...base,
      VERCEL_ENV: "production",
      VERCEL_GIT_COMMIT_REF: "main",
      VERCEL_GIT_PREVIOUS_SHA: shas.voice,
      VERCEL_GIT_COMMIT_SHA: shas.docs,
    });
    assert.equal(r.status, 1, r.out);
  });

  it("always builds main", () => {
    const r = run({ ...base, VERCEL_GIT_COMMIT_REF: "main", VERCEL_GIT_PREVIOUS_SHA: shas.voice, VERCEL_GIT_COMMIT_SHA: shas.docs });
    assert.equal(r.status, 1, r.out);
  });

  it("skips the staging branch, which only scalers-staging serves", () => {
    const r = run({ ...base, VERCEL_GIT_COMMIT_REF: STAGING_BRANCH, VERCEL_GIT_PREVIOUS_SHA: shas.root, VERCEL_GIT_COMMIT_SHA: shas.docs });
    assert.equal(r.status, 0, r.out);
  });

  it("first deploy falls back to HEAD^ (tip only)", () => {
    assert.equal(run({ ...base, VERCEL_GIT_COMMIT_SHA: shas.docs }).status, 0);
    assert.equal(run({ ...base, VERCEL_GIT_COMMIT_SHA: shas.desk }).status, 1);
  });

  it("builds when the last built SHA is not in the clone", () => {
    const r = run({ ...base, VERCEL_GIT_PREVIOUS_SHA: "0123456789abcdef0123456789abcdef01234567", VERCEL_GIT_COMMIT_SHA: shas.docs });
    assert.equal(r.status, 1, r.out);
  });

  it("builds when there is no parent commit", () => {
    const r = run({ ...base, VERCEL_GIT_COMMIT_SHA: shas.root });
    assert.equal(r.status, 1, r.out);
  });
});

describe("vercel-ignore-build.sh on scalers-staging", () => {
  const base = { VERCEL_PROJECT_ID: STAGING, VERCEL_ENV: "preview" };

  it("always builds the staging branch, even with no Desk change", () => {
    const r = run({ ...base, VERCEL_GIT_COMMIT_REF: STAGING_BRANCH, VERCEL_GIT_PREVIOUS_SHA: shas.voice, VERCEL_GIT_COMMIT_SHA: shas.docs });
    assert.equal(r.status, 1, r.out);
  });

  it("skips a feature branch, even with a Desk change", () => {
    const r = run({ ...base, VERCEL_GIT_COMMIT_REF: "cursor/desk-thing", VERCEL_GIT_PREVIOUS_SHA: shas.root, VERCEL_GIT_COMMIT_SHA: shas.desk });
    assert.equal(r.status, 0, r.out);
  });

  it("skips main (production target on scalers-staging)", () => {
    const r = run({ ...base, VERCEL_ENV: "production", VERCEL_GIT_COMMIT_REF: "main", VERCEL_GIT_COMMIT_SHA: shas.desk });
    assert.equal(r.status, 0, r.out);
  });

  it("recognises scalers-staging by hostname when the project id is missing", () => {
    const r = run({ VERCEL_URL: "scalers-staging-abc123-team.vercel.app", VERCEL_GIT_COMMIT_REF: "cursor/desk-thing" });
    assert.equal(r.status, 0, r.out);
  });
});

describe("vercel-ignore-build.sh fails safe", () => {
  it("builds when system env vars are not exposed", () => {
    const r = run({ VERCEL_GIT_COMMIT_REF: "cursor/x", VERCEL_GIT_COMMIT_SHA: shas.docs });
    assert.equal(r.status, 1, r.out);
  });

  it("builds for an unknown project", () => {
    const r = run({ VERCEL_PROJECT_ID: "prj_other", VERCEL_ENV: "preview", VERCEL_GIT_COMMIT_REF: "cursor/x", VERCEL_GIT_PREVIOUS_SHA: shas.desk, VERCEL_GIT_COMMIT_SHA: shas.voice });
    assert.equal(r.status, 1, r.out);
  });
});

describe("dashboard/vercel.json", () => {
  it("wires the ignore script relative to the dashboard root", () => {
    const config = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "dashboard", "vercel.json"), "utf8"));
    assert.equal(config.framework, "nextjs");
    assert.equal(config.ignoreCommand, "bash scripts/vercel-ignore-build.sh");
    assert.ok(fs.existsSync(path.join(__dirname, "..", "dashboard", config.ignoreCommand.split(" ")[1])));
  });
});
