const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const { spawnSync } = require("child_process");

const helperPath = path.join(__dirname, "../dashboard/src/lib/visitPlace.ts");

function load(scriptBody) {
  const script = `
    import { collapseJobsByCall, pickVisitLandmark } from ${JSON.stringify(helperPath)};
    ${scriptBody}
  `;
  const ran = spawnSync(
    process.execPath,
    ["--experimental-strip-types", "--input-type=module", "-e", script],
    { encoding: "utf8" }
  );
  assert.equal(ran.status, 0, ran.stderr || ran.stdout);
  return JSON.parse(ran.stdout.trim().split("\n").at(-1));
}

function job(partial) {
  return {
    id: "job",
    created_at: "2026-09-29T06:00:00.000Z",
    service_name: "Cleaning",
    status: "requested",
    when_text: "Saturday",
    address_landmark: null,
    notes: null,
    caller_name: "Amina",
    caller_phone: "254700000001",
    call_id: "call-1",
    ...partial,
  };
}

describe("visit place", () => {
  it("keeps one landmark when a parent tail or a hearing slip is the other row", () => {
    const picked = load(`
      console.log(JSON.stringify([
        pickVisitLandmark(["Iwasha", "Naivasha"]),
        pickVisitLandmark(["Westlands, Nairobi", "Westlands"]),
        pickVisitLandmark(["Westlands", "Westlands opposite Naivas"]),
        pickVisitLandmark(["Kilimani", "Westlands"]),
      ]));
    `);
    assert.deepEqual(picked, [
      "Naivasha",
      "Westlands",
      "Westlands opposite Naivas",
      "Kilimani",
    ]);
  });

  it("collapses two appointments on one call into the better place", () => {
    const rows = load(`
      const jobs = ${JSON.stringify([
        job({ id: "new", address_landmark: "Iwasha", created_at: "2026-09-29T08:00:00.000Z" }),
        job({
          id: "old",
          address_landmark: "Naivasha",
          created_at: "2026-09-29T07:00:00.000Z",
          status: "requested",
        }),
        job({ id: "other", call_id: null, address_landmark: "Kisumu" }),
      ])};
      console.log(JSON.stringify(collapseJobsByCall(jobs).map((row) => ({
        id: row.id,
        place: row.address_landmark,
        call_id: row.call_id,
      }))));
    `);
    assert.deepEqual(rows, [
      { id: "new", place: "Naivasha", call_id: "call-1" },
      { id: "other", place: "Kisumu", call_id: null },
    ]);
  });
});
