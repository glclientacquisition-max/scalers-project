const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("node:child_process");

function read(rel) {
  return fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
}

function load() {
  const helperPath = path.join(__dirname, "../dashboard/src/lib/endlessList.ts");
  const script = `
    import { nextShown, appendUniqueById, LIST_SLICE } from ${JSON.stringify(helperPath)};
    const first = [{ id: "a" }, { id: "b" }];
    const more = appendUniqueById(first, [{ id: "b" }, { id: "c" }, { id: "" }]);
    const again = appendUniqueById(more.rows, [{ id: "c" }]);
    console.log(JSON.stringify({
      slice: LIST_SLICE,
      step: nextShown(25, 80, 25),
      cap: nextShown(70, 80, 25),
      stay: nextShown(80, 80, 25),
      short: nextShown(25, 10, 25),
      added: more.added,
      ids: more.rows.map((row) => row.id),
      again: again.added,
    }));
  `;
  const ran = spawnSync(
    process.execPath,
    ["--experimental-strip-types", "--input-type=module", "-e", script],
    { encoding: "utf8" }
  );
  assert.equal(ran.status, 0, ran.stderr || ran.stdout);
  return JSON.parse(ran.stdout.trim().split("\n").at(-1));
}

describe("endless list slices", () => {
  it("grows by one page and skips ids already on screen", () => {
    const out = load();
    assert.equal(out.slice, 25);
    assert.equal(out.step, 50);
    assert.equal(out.cap, 80);
    assert.equal(out.stay, 80);
    assert.equal(out.short, 25);
    assert.equal(out.added, 1);
    assert.deepEqual(out.ids, ["a", "b", "c"]);
    assert.equal(out.again, 0);
  });

  it("keeps one contacts dataset for phone and desktop, with a quiet loading row", () => {
    const list = read("dashboard/src/components/ContactsEndlessList.tsx");
    const sentinel = read("dashboard/src/components/EndlessList.tsx");
    assert.match(list, /ContactPhoneRow/);
    assert.match(list, /ContactTableRow/);
    assert.match(list, /md:hidden/);
    assert.match(list, /hidden min-w-0 md:mt-8 md:block/);
    assert.match(list, /appendUniqueById/);
    assert.match(list, /listWindowClass/);
    assert.match(sentinel, /Loading/);
    assert.match(sentinel, /min-h-11/);
    assert.match(read("dashboard/src/lib/endlessList.ts"), /content-visibility:auto/);
    assert.doesNotMatch(list, /<Pagination/);
    assert.doesNotMatch(list, /[\u2014\u2013]/);
    assert.doesNotMatch(sentinel, /end of list/i);
  });

  it("resets the inbox window when the pile or search changes", () => {
    const nav = read("dashboard/src/components/InboxPileNav.tsx");
    const board = read("dashboard/src/components/InboxPileBoard.tsx");
    assert.match(nav, /setShown\(DEFAULT_PAGE_SIZE\)/);
    assert.match(nav, /scrollDeskWellToTop/);
    assert.match(nav, /listed\.slice\(0, windowCount\)/);
    assert.match(board, /EndlessSentinel/);
    assert.match(board, /lg:hidden/);
    assert.match(board, /hidden lg:block/);
    assert.match(board, /listWindowClass/);
    assert.doesNotMatch(board, /<Pagination/);
  });
});
