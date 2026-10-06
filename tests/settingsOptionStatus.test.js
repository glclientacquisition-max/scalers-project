const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const { spawnSync } = require("node:child_process");

function load(expr) {
  const file = path.join(__dirname, "..", "dashboard/src/lib/settingsOptionStatus.ts");
  const script = `
    import * as mod from ${JSON.stringify(file)};
    const value = ${expr};
    process.stdout.write(JSON.stringify(value));
  `;
  const ran = spawnSync(
    process.execPath,
    ["--experimental-strip-types", "--input-type=module", "-e", script],
    { encoding: "utf8" }
  );
  assert.equal(ran.status, 0, ran.stderr || ran.stdout);
  return JSON.parse(ran.stdout);
}

describe("settings row status", () => {
  it("names a count and skips the business name already in the header", () => {
    assert.equal(
      load(
        `mod.settingsOptionStatus({ tab: "catalog" }, { services_catalog: [{ name: "A4 print" }] })`
      ),
      "1 service"
    );
    assert.equal(
      load(
        `mod.settingsOptionStatus({ tab: "catalog" }, { product_catalog: [{ name: "Ink" }, { name: "Paper" }] })`
      ),
      "2 products"
    );
    assert.equal(
      load(
        `mod.settingsOptionStatus({ tab: "catalog" }, { services_catalog: [{ name: "Print" }], product_catalog: [{ name: "Ink" }] })`
      ),
      "2 items"
    );
    assert.equal(
      load(
        `mod.settingsOptionStatus({ tab: "train", panel: "team" }, { team_directory: [{ name: "Amina" }] })`
      ),
      "1 person"
    );
    assert.equal(
      load(
        `mod.settingsOptionStatus({ tab: "train", panel: "team" }, { team_directory: [{ name: "Amina" }, { name: "Nia" }] })`
      ),
      "2 people"
    );
    assert.equal(
      load(
        `mod.settingsOptionStatus({ tab: "train", panel: "faqs" }, { faqs: [{ question: "Parking", answer: "Street" }] })`
      ),
      "1 question"
    );
    assert.equal(
      load(
        `mod.settingsOptionStatus({ tab: "train", panel: "locations" }, { business_locations: [{ label: "Westlands" }] })`
      ),
      "1 place"
    );
    assert.equal(
      load(
        `mod.settingsOptionStatus({ tab: "train", panel: "pronunciation" }, { tts_lexicon: [{}, {}] })`
      ),
      "2 words"
    );
    assert.equal(
      load(
        `mod.settingsOptionStatus({ tab: "train", panel: "identity" }, { business_name: "Chapter One", agent_tone: "warm", agent_name: "Aisha" })`
      ),
      "Warm"
    );
    assert.equal(
      load(
        `mod.settingsOptionStatus({ tab: "train", panel: "identity" }, { business_name: "Chapter One", agent_name: "Aisha" })`
      ),
      "Aisha"
    );
  });

  it("keeps a voice name on the row and the full line on the title", () => {
    const voices = `[{ id: "v1", description: "Warm Kenyan receptionist tone" }]`;
    assert.equal(
      load(
        `mod.settingsOptionStatus({ tab: "train", panel: "tools" }, { soniox_voice_id: "v1" }, ${voices})`
      ),
      "Warm Kenyan"
    );
    const row = load(
      `mod.settingsIndexStatuses({ soniox_voice_id: "v1" }, ${voices}, [{ tab: "train", panel: "tools" }])`
    );
    assert.deepEqual(row["train:tools"], {
      text: "Warm Kenyan",
      title: "Warm Kenyan receptionist tone",
    });
  });
});
