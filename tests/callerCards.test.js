const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

describe("caller cards", () => {
  it("pins needs-you and uses one Call button", () => {
    const lib = read("dashboard/src/lib/callerCards.ts");
    const ui = read("dashboard/src/components/home/CallerCards.tsx");
    assert.match(lib, /itemIsToReturn/);
    assert.match(lib, /latest/);
    assert.match(ui, /label="Call"/);
    assert.match(ui, /See all/);
    assert.doesNotMatch(ui, /WhatsApp/);
    assert.doesNotMatch(ui, /cut off/);
  });
});
