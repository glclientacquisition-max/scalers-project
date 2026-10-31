const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const { spawnSync } = require("node:child_process");

function load(expr) {
  const file = path.join(__dirname, "..", "dashboard/src/lib/identityGreeting.ts");
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

const tenant = {
  business_name: "Done and Dusted",
  agent_name: "Shy",
  greeting_text: "Karibu Done and Dusted, tunasafisha nyumba na ofisi. Tukusaidie vipi?",
  greeting_invite: "",
  spoken_name: "",
};

describe("played greeting", () => {
  it("gives Identity, What callers hear and Test the same string", () => {
    const line = load(`mod.playedGreetingFromTenant(${JSON.stringify(tenant)})`);
    assert.equal(line, tenant.greeting_text);
    const again = load(`mod.playedGreetingFromTenant(${JSON.stringify(tenant)})`);
    assert.equal(again, line);
  });
});
