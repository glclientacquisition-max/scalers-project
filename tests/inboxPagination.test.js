const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

function read(rel) {
  return fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
}

describe("inbox pagination page jump", () => {
  const src = read("dashboard/src/components/ui/Pagination.tsx");
  const calls = read("dashboard/src/app/(desk)/calls/page.tsx");
  const board = read("dashboard/src/components/InboxPileBoard.tsx");

  it("keeps Previous and Next at 44px", () => {
    assert.match(src, /Previous/);
    assert.match(src, /Next/);
    assert.match(src, /min-h-11/);
    assert.match(board, /<Pagination/);
  });

  it("renders a page input only when totalPages is greater than 5", () => {
    assert.match(src, /totalPages > 5 \? \(/);
    assert.match(src, /htmlFor=\{jumpId\}/);
    assert.match(src, />\s*Page\s*</);
    assert.match(src, /type="number"/);
    assert.match(src, /name="page"/);
    assert.match(src, />\s*Go\s*</);
    assert.match(src, /h-11 w-14/);
    assert.doesNotMatch(src, /[\u2014\u2013]/);
  });

  it("clamps a page past the end and shares that helper", () => {
    const listPage = read("dashboard/src/lib/listPage.ts")
      .replace(/export /g, "")
      .replace(/: number/g, "");
    const api = new Function(`${listPage}; return { clampListPage, listPageSpan };`)();
    assert.equal(api.clampListPage(9, 40, 25), 2);
    assert.equal(api.clampListPage(1, 0, 25), 1);
    assert.deepEqual(api.listPageSpan(9, 25, 40), { page: 2, from: 26, to: 40, pages: 2 });
    assert.match(read("dashboard/src/components/InboxPileNav.tsx"), /clampListPage/);
    assert.match(read("dashboard/src/app/(desk)/contacts/page.tsx"), /clampListPage/);
    assert.match(read("dashboard/src/components/ui/ListPager.tsx"), /min-h-11/);
    assert.match(read("dashboard/src/components/PronunciationCoach.tsx"), /<ListPager/);
    assert.match(read("dashboard/src/components/TenantForm.tsx"), /<ListPager/);
  });

  it("does not replace Prev/Next with the jump control", () => {
    const jumpAt = src.indexOf("totalPages > 5");
    const prevAt = src.indexOf("Previous");
    const nextAt = src.lastIndexOf("Next");
    assert.ok(prevAt > 0 && jumpAt > prevAt && nextAt > jumpAt);
  });
});
