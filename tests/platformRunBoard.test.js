const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

describe("platform run board", () => {
  it("derives degraded speech from soniox billingExhausted on healthz", () => {
    const model = read("dashboard/src/lib/platformRunBoardModel.ts");
    assert.match(model, /last\?\.billingExhausted/);
    assert.match(model, /label: "Degraded"/);
    assert.match(model, /deriveSpeechHealth/);
  });

  it("derives degraded reasoning from gemini billingExhausted and denied", () => {
    const model = read("dashboard/src/lib/platformRunBoardModel.ts");
    assert.match(model, /snap\?\.billingExhausted/);
    assert.match(model, /snap\?\.denied/);
    assert.match(model, /deriveReasoningHealth/);
  });

  it("fetches voice healthz read-only from the public voice base", () => {
    const health = read("dashboard/src/lib/platformVoiceHealth.ts");
    assert.match(health, /\/healthz/);
    assert.match(health, /cache: "no-store"/);
    assert.doesNotMatch(health, /VOICE_INTERNAL_SECRET/);
  });

  it("admin Platform page uses the run board without a vendor telecom headline", () => {
    const page = read("dashboard/src/app/admin/(console)/platform/page.tsx");
    const board = read("dashboard/src/components/PlatformRunBoard.tsx");
    assert.match(page, /PlatformRunBoard/);
    assert.doesNotMatch(page, /SautikitTelecomPanel/);
    const model = read("dashboard/src/lib/platformRunBoardModel.ts");
    assert.match(model, /title: "Speech"/);
    assert.match(model, /title: "Reasoning"/);
    assert.match(board, /Phone line/);
    assert.doesNotMatch(board, /SautiKit/);
    assert.doesNotMatch(board, /Telecom \(/);
  });
});
