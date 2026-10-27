const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const helperPath = path.join(__dirname, "../dashboard/src/lib/coverageRank.ts");

function rank(query) {
  const script = `
    import { rankCoverageAreas } from ${JSON.stringify(helperPath)};
    const directory = [
      { id: "county:baringo", label: "Baringo", kind: "county", search: "baringo" },
      { id: "county:nairobi", label: "Nairobi", kind: "county", search: "nairobi" },
      { id: "place:westlands", label: "Westlands, Nairobi", kind: "place", search: "westlands nairobi" },
      { id: "place:kabarnet", label: "Kabarnet, Baringo", kind: "place", search: "kabarnet baringo" },
      { id: "place:nairobi west", label: "Nairobi West, Nairobi", kind: "place", search: "nairobi west nairobi" },
    ];
    const rows = rankCoverageAreas(directory, ${JSON.stringify(query)}, []);
    console.log(JSON.stringify(rows.map((row) => row.id)));
  `;
  const ran = spawnSync(
    process.execPath,
    ["--experimental-strip-types", "--input-type=module", "-e", script],
    { encoding: "utf8" }
  );
  assert.equal(ran.status, 0, ran.stderr || ran.stdout);
  return JSON.parse(ran.stdout.trim().split("\n").at(-1));
}

describe("coverage type-to-find", () => {
  it("finds Westlands from an estate name and from Nairobi plus a prefix", () => {
    const west = rank("westlands");
    assert.equal(west[0], "place:westlands");
    const both = rank("nairobi west");
    assert.equal(both[0], "place:nairobi west");
    assert.equal(both.includes("county:nairobi"), false);
  });

  it("finds Kabarnet inside Baringo without stopping at the county", () => {
    const rows = rank("baringo kaba");
    assert.equal(rows[0], "place:kabarnet");
  });

  it("keeps an empty query on counties", () => {
    const rows = rank("");
    assert.deepEqual(rows, ["county:baringo", "county:nairobi"]);
  });

  // ServiceAreasEditor and CoverageAreaField were removed in #964 (43d9870b). Service areas is AreaPicker on Settings › Service areas (#964 design): one search box for areas and landmarks; nothing is ticked until the owner taps a row.
  it("Service areas search hints places and landmarks and never preselects", () => {
    const picker = fs.readFileSync(
      path.join(__dirname, "../dashboard/src/components/areas/AreaPicker.tsx"),
      "utf8"
    );
    assert.match(picker, /placeholder="Search area or landmark"/);
    assert.match(picker, /<SearchResults results=\{results\}[^>]*onToggle=\{\(id\) => setPicks\(toggleArea\(picks, id\)\)\}/);
    assert.doesNotMatch(picker, /results\[0\][^\n]*toggleArea/);
  });
});
