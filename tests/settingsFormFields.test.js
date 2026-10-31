const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const { spawnSync } = require("node:child_process");

function load(expr) {
  const file = path.join(__dirname, "..", "dashboard/src/lib/settingsFormFields.ts");
  const script = `
    import * as mod from ${JSON.stringify(file)};
    const value = ${expr};
    process.stdout.write(JSON.stringify(value));
  `;
  const ran = spawnSync(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", script], {
    encoding: "utf8",
  });
  assert.equal(ran.status, 0, ran.stderr || ran.stdout);
  return JSON.parse(ran.stdout);
}

describe("settings form fields", () => {
  it("sends only hours fields from Hours", () => {
    const names = load("mod.PANEL_POST_FIELDS.hours");
    assert.equal(load(`mod.hoursPayloadIsScoped(${JSON.stringify(names)})`), true);
    assert.equal(load(`mod.panelPostsField("hours", "faqs")`), false);
    assert.equal(load(`mod.panelPostsField("hours", "hours_schedule")`), true);
    assert.equal(load(`mod.panelPostsField("faqs", "faqs")`), true);
    assert.equal(load(`mod.panelPostsField("faqs", "hours_schedule")`), false);
    assert.equal(load(`mod.panelPostsField("tools", "tool_escalate")`), true);
    assert.equal(load(`mod.panelPostsField("team", "team_directory")`), true);
    assert.equal(load(`mod.panelPostsField("pronunciation", "tts_lexicon")`), true);
    assert.equal(load(`mod.panelPostsField("locations", "business_locations")`), true);
  });
});
