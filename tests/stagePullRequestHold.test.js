const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  isTruthyHold,
  labeledPullNumbers,
  stagePrHoldNotice,
  isMissingHoldLabel,
  listHoldStagingPulls,
  runHoldCheck,
  STAGING_BRANCH,
} = require("../scripts/stage-pull-request-hold");

const workflowPath = path.join(__dirname, "../.github/workflows/stage-pull-request.yml");

describe("isTruthyHold", () => {
  for (const value of ["1", "true", "on", "TRUE", "On", "  true  ", "1\n"]) {
    it(`holds for ${JSON.stringify(value)}`, () => {
      assert.equal(isTruthyHold(value), true);
    });
  }

  for (const value of ["", "0", "false", "off", "FALSE", "Off", "yes", "2", "truee", undefined, null]) {
    it(`does not hold for ${JSON.stringify(value)}`, () => {
      assert.equal(isTruthyHold(value), false);
    });
  }
});

describe("stagePrHoldNotice", () => {
  it("names the variable that fired", () => {
    assert.equal(
      stagePrHoldNotice({ variable: " 1 ", pullNumbers: [] }),
      "Stage-PR hold active (STAGE_PR_HOLD=1): skipping staging re-point"
    );
  });

  it("names open pull requests that carry the label", () => {
    assert.equal(
      stagePrHoldNotice({ variable: "", pullNumbers: [{ number: 40 }, { number: 12 }, { number: 12 }] }),
      "Stage-PR hold active (label hold-staging on #12, #40): skipping staging re-point"
    );
  });

  it("names both switches when both fire", () => {
    assert.equal(
      stagePrHoldNotice({ variable: "true", pullNumbers: [{ number: 7 }] }),
      "Stage-PR hold active (STAGE_PR_HOLD=true / label hold-staging on #7): skipping staging re-point"
    );
  });

  it("is silent when neither switch fires", () => {
    assert.equal(stagePrHoldNotice({ variable: "0", pullNumbers: [] }), null);
    assert.equal(stagePrHoldNotice({ variable: "false", pullNumbers: [{ number: "nope" }] }), null);
  });
});

describe("labeledPullNumbers", () => {
  it("keeps positive integers only", () => {
    assert.deepEqual(labeledPullNumbers([{ number: 3 }, null, { number: 0 }, { number: 1.5 }]), [3]);
  });
});

describe("isMissingHoldLabel", () => {
  it("treats a missing hold-staging label as no labeled pulls", () => {
    assert.equal(isMissingHoldLabel('HTTP 404: label hold-staging does not exist'), true);
    assert.equal(isMissingHoldLabel("could not resolve to a Repository"), false);
  });
});

describe("listHoldStagingPulls", () => {
  it("asks gh for open pull requests with the label", () => {
    const calls = [];
    const numbers = listHoldStagingPulls({
      repo: "glclientacquisition-max/scalers-project",
      exec(cmd, args) {
        calls.push([cmd, args]);
        return JSON.stringify([{ number: 9 }]);
      },
    });
    assert.deepEqual(numbers, [9]);
    assert.deepEqual(calls[0][1], [
      "pr",
      "list",
      "--repo",
      "glclientacquisition-max/scalers-project",
      "--state",
      "open",
      "--label",
      "hold-staging",
      "--limit",
      "200",
      "--json",
      "number",
    ]);
  });
});

describe("runHoldCheck", () => {
  function tempFiles() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "stage-hold-"));
    return {
      outputPath: path.join(dir, "output"),
      summaryPath: path.join(dir, "summary"),
    };
  }

  it("writes hold=false and does not announce a skip when nothing is held", () => {
    const { outputPath, summaryPath } = tempFiles();
    const lines = [];
    const result = runHoldCheck({
      variable: "",
      repo: "acme/scalers",
      outputPath,
      summaryPath,
      log: (line) => lines.push(line),
      exec() {
        return "[]";
      },
    });
    assert.deepEqual(result, { hold: false, sentence: null });
    assert.equal(fs.readFileSync(outputPath, "utf8"), "hold=false\n");
    assert.equal(fs.existsSync(summaryPath), false);
    assert.deepEqual(lines, ["Stage-PR hold inactive"]);
  });

  it("announces the skip and records that the staging branch was not pushed", () => {
    const { outputPath, summaryPath } = tempFiles();
    const lines = [];
    const result = runHoldCheck({
      variable: "1",
      repo: "acme/scalers",
      outputPath,
      summaryPath,
      log: (line) => lines.push(line),
      exec() {
        return JSON.stringify([{ number: 15 }]);
      },
    });
    assert.equal(result.hold, true);
    assert.equal(
      result.sentence,
      "Stage-PR hold active (STAGE_PR_HOLD=1 / label hold-staging on #15): skipping staging re-point"
    );
    assert.equal(fs.readFileSync(outputPath, "utf8"), "hold=true\n");
    assert.equal(
      fs.readFileSync(summaryPath, "utf8"),
      `${result.sentence}\nBranch ${STAGING_BRANCH} was not pushed.\n`
    );
    assert.equal(lines[0], `::notice::${result.sentence}`);
  });

  it("still holds on the variable when the label query fails", () => {
    const { outputPath } = tempFiles();
    const lines = [];
    const result = runHoldCheck({
      variable: "on",
      repo: "acme/scalers",
      outputPath,
      log: (line) => lines.push(line),
      exec() {
        const error = new Error("gh failed");
        error.stderr = "temporary failure";
        throw error;
      },
    });
    assert.equal(result.hold, true);
    assert.match(result.sentence, /STAGE_PR_HOLD=on/);
    assert.equal(fs.readFileSync(outputPath, "utf8"), "hold=true\n");
    assert.match(lines.join("\n"), /::warning::/);
  });

  it("fails closed when the label query fails and the variable is off", () => {
    const { outputPath } = tempFiles();
    assert.throws(() =>
      runHoldCheck({
        variable: "0",
        repo: "acme/scalers",
        outputPath,
        exec() {
          const error = new Error("gh failed");
          error.stderr = "bad credentials";
          throw error;
        },
      })
    );
    assert.equal(fs.existsSync(outputPath), false);
  });

  it("treats a missing label as no label hold", () => {
    const { outputPath } = tempFiles();
    const result = runHoldCheck({
      variable: "off",
      repo: "acme/scalers",
      outputPath,
      exec() {
        const error = new Error("not found");
        error.stderr = "HTTP 404: label hold-staging does not exist";
        throw error;
      },
    });
    assert.equal(result.hold, false);
    assert.equal(fs.readFileSync(outputPath, "utf8"), "hold=false\n");
  });
});

describe("stage workflow wiring", () => {
  const yaml = fs.readFileSync(workflowPath, "utf8");

  it("still reconnects Railway with serviceConnect on the no-hold path", () => {
    assert.match(yaml, /serviceConnect/);
    assert.match(yaml, /cursor\/staging-voice-468b/);
    assert.match(yaml, /node scripts\/stage-pull-request\.js/);
  });

  it("skips the branch push and the Railway reconnect while held", () => {
    assert.match(yaml, /node scripts\/stage-pull-request-hold\.js/);
    assert.match(
      yaml,
      /steps\.hold\.outcome == 'success' && steps\.hold\.outputs\.hold != 'true'/
    );
    const connectAt = yaml.indexOf("Connect Railway staging Voice");
    const connectIf = yaml.slice(connectAt, connectAt + 500);
    assert.match(connectIf, /steps\.hold\.outputs\.hold != 'true'/);
    assert.match(connectIf, /steps\.stage\.outcome != 'skipped'/);
  });
});
