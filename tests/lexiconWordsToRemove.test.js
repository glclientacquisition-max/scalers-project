const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const { spawnSync } = require("node:child_process");

function load(expr) {
  const file = path.join(__dirname, "..", "dashboard/src/lib/pronunciationLexicon.ts");
  const script = `
    import { lexiconWordsToRemove } from ${JSON.stringify(file)};
    const value = ${expr};
    process.stdout.write(JSON.stringify(value));
  `;
  const ran = spawnSync(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", script], {
    encoding: "utf8",
  });
  assert.equal(ran.status, 0, ran.stderr || ran.stdout);
  return JSON.parse(ran.stdout);
}

describe("lexiconWordsToRemove", () => {
  it("counts stored rows the cleaner drops", () => {
    const n = load(`lexiconWordsToRemove([
      { match: "Ngong", say: "Gong" },
      { match: "the", say: "thee" },
      { match: "hello", say: "heh-loh" },
    ])`);
    assert.equal(n, 2);
  });

  it("is zero when every row can stay", () => {
    assert.equal(load(`lexiconWordsToRemove([{ match: "Ngong", say: "Gong" }])`), 0);
  });

  it("is zero for an empty store", () => {
    assert.equal(load(`lexiconWordsToRemove(null)`), 0);
    assert.equal(load(`lexiconWordsToRemove("")`), 0);
    assert.equal(load(`lexiconWordsToRemove("not json")`), 0);
  });
});
