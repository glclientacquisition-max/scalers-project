// OPS.md §5: no vendor or infrastructure names, no filler, on any Ops screen.
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const dash = path.join(__dirname, "../dashboard/src");
const dirs = ["components/ops", "lib/ops", "app/admin/(console)/%5Fkit"];

describe("ops banned words", async () => {
  const { findBannedWords } = await import("../dashboard/src/lib/ops/copy.ts");
  it("finder catches vendors and filler", () => {
    assert.deepEqual(findBannedWords("Saved to Supabase. Coming soon!"), ["supabase", "coming soon"]);
    assert.deepEqual(findBannedWords("Grant minutes"), []);
  });
  for (const d of dirs) {
    for (const f of fs.readdirSync(path.join(dash, d))) {
      if (f === "copy.ts") continue;
      it(`${d}/${f}`, () => {
        const src = fs.readFileSync(path.join(dash, d, f), "utf8").replace(/^\s*(import|export) .*$/gm, "");
        const strings = [...src.matchAll(/"([^"\n]*)"|>([^<>{}\n]+)</g)].map((m) => m[1] ?? m[2]).join("\n");
        assert.deepEqual(findBannedWords(strings), [], f);
      });
    }
  }
});
