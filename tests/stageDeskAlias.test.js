const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const {
  STAGING_ALIAS,
  STAGING_BRANCH,
  STAGING_PROJECT_ID,
  PRODUCTION_DESK_PROJECT_ID,
  stagingProjectPinBody,
  assertStagingTarget,
  pickReadyDeployment,
  assignStagingDesk,
  readStagingSha,
} = require("../scripts/stage-desk-alias");

const SHA = "9e60d9ac0753ba8243fea105e18d6f303ab3484d";

function readyDeployment(overrides = {}) {
  return {
    uid: "dpl_staging",
    created: 20,
    state: "READY",
    projectId: STAGING_PROJECT_ID,
    meta: {
      githubCommitRef: STAGING_BRANCH,
      githubCommitSha: SHA,
    },
    ...overrides,
  };
}

describe("pickReadyDeployment", () => {
  it("picks the newest READY deploy of the staging sha", () => {
    const picked = pickReadyDeployment(
      [
        readyDeployment({ uid: "dpl_old", created: 10 }),
        readyDeployment({ uid: "dpl_new", created: 30 }),
        readyDeployment({
          uid: "dpl_other",
          created: 40,
          meta: { githubCommitRef: "main", githubCommitSha: SHA },
        }),
      ],
      { sha: SHA, branch: STAGING_BRANCH, projectId: STAGING_PROJECT_ID }
    );
    assert.equal(picked.uid, "dpl_new");
  });

  it("refuses the production desk project", () => {
    assert.throws(
      () =>
        pickReadyDeployment([], {
          sha: SHA,
          branch: STAGING_BRANCH,
          projectId: PRODUCTION_DESK_PROJECT_ID,
        }),
      /production desk/
    );
  });

  it("refuses a production hostname", () => {
    assert.throws(
      () =>
        assertStagingTarget({
          projectId: STAGING_PROJECT_ID,
          alias: "www.scalers.co.ke",
          branch: STAGING_BRANCH,
        }),
      /alias/
    );
  });
});

describe("stagingProjectPinBody", () => {
  it("builds only the staging branch and does not auto-assign the alias", () => {
    const body = stagingProjectPinBody();
    assert.equal(body.autoAssignCustomDomains, false);
    assert.ok(body.commandForIgnoringBuildStep.length <= 256);
    const run = (ref) =>
      spawnSync("sh", ["-c", body.commandForIgnoringBuildStep], {
        env: { ...process.env, VERCEL_GIT_COMMIT_REF: ref },
      }).status;
    assert.equal(run(STAGING_BRANCH), 1, "staging branch builds");
    assert.equal(run("main"), 0, "main is skipped");
    assert.equal(run("cursor/some-feature-1234"), 0, "feature branches are skipped");
    assert.equal(run(""), 0, "unnamed ref is skipped");
  });
});

describe("assignStagingDesk", () => {
  it("pins the staging project and assigns the ready deploy", async () => {
    const calls = [];
    const fetchImpl = async (url, options = {}) => {
      calls.push({ url, method: options.method || "GET", body: options.body });
      if (url.includes("/v9/projects/")) {
        return jsonResponse({ id: STAGING_PROJECT_ID });
      }
      if (url.includes("/v6/deployments")) {
        return jsonResponse({ deployments: [readyDeployment()] });
      }
      if (url.includes("/aliases")) {
        return jsonResponse({ alias: STAGING_ALIAS });
      }
      return jsonResponse({
        meta: { githubCommitSha: SHA, githubCommitRef: STAGING_BRANCH },
        projectId: STAGING_PROJECT_ID,
      });
    };

    const assigned = await assignStagingDesk({
      token: "test-token",
      sha: SHA,
      fetchImpl,
      sleep: async () => {},
      now: () => 0,
    });

    assert.equal(assigned.deploymentId, "dpl_staging");
    assert.equal(assigned.alias, STAGING_ALIAS);
    assert.equal(calls[0].method, "PATCH");
    assert.equal(JSON.parse(calls[0].body).autoAssignCustomDomains, false);
    assert.equal(calls.some((call) => call.method === "POST" && call.url.includes("/aliases")), true);
    assert.equal(calls.some((call) => call.url.includes("www.scalers.co.ke")), false);
  });

  it("fails when the token is missing", async () => {
    await assert.rejects(
      () => assignStagingDesk({ token: "", sha: SHA, fetchImpl: async () => jsonResponse({}) }),
      /VERCEL_TOKEN is not set/
    );
  });

  it("stops when the sha never becomes READY", async () => {
    let ticks = 0;
    await assert.rejects(
      () =>
        assignStagingDesk({
          token: "test-token",
          sha: SHA,
          timeoutMs: 10,
          fetchImpl: async (url) => {
            if (url.includes("/v9/projects/")) return jsonResponse({});
            return jsonResponse({ deployments: [] });
          },
          sleep: async () => {},
          now: () => (ticks++ === 0 ? 0 : 11),
        }),
      /No READY deployment/
    );
  });
});

describe("readStagingSha", () => {
  it("reads stagingSha from the stage result", () => {
    const file = path.join(os.tmpdir(), `stage-result-${process.pid}.json`);
    fs.writeFileSync(file, JSON.stringify({ stagingSha: SHA, status: "rebuilt" }));
    assert.equal(readStagingSha(file), SHA);
    fs.unlinkSync(file);
  });
});

function jsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(payload),
  };
}
