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
    import { nextShown, appendUniqueById, LIST_SLICE, pullRefreshCommit, listAfterPullRefresh, pickPullScrollTop, shellPullPlan, deskFieldsDirty, shellPullErrorCopy } from ${JSON.stringify(helperPath)};
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
      phone: pullRefreshCommit({ phone: true, scrollTop: 0, dx: 0, dy: 72 }),
      nudge: pullRefreshCommit({ phone: true, scrollTop: 0, dx: 0, dy: 20 }),
      scrolled: pullRefreshCommit({ phone: true, scrollTop: 40, dx: 0, dy: 80 }),
      sideways: pullRefreshCommit({ phone: true, scrollTop: 0, dx: 90, dy: 80 }),
      desktop: pullRefreshCommit({ phone: false, scrollTop: 0, dx: 0, dy: 90 }),
      kept: listAfterPullRefresh([{ id: "a" }], null, true).reset,
      keptIds: listAfterPullRefresh([{ id: "a" }, { id: "b" }], null, true).rows.map((row) => row.id),
      fresh: listAfterPullRefresh([{ id: "a" }, { id: "b" }], [{ id: "c" }], false).reset,
      freshIds: listAfterPullRefresh([{ id: "a" }], [{ id: "c" }], false).rows.map((row) => row.id),
      deskTop: pickPullScrollTop({ deskScrolls: true, deskTop: 0, paneScrolls: true, paneTop: 40 }),
      paneTop: pickPullScrollTop({ deskScrolls: false, deskTop: 0, paneScrolls: true, paneTop: 40 }),
      paneClear: pickPullScrollTop({ deskScrolls: false, deskTop: 0, paneScrolls: true, paneTop: 0 }),
      skipDirty: shellPullPlan({ dirty: true, failed: false }),
      keepFail: shellPullPlan({ dirty: false, failed: true }),
      refreshClean: shellPullPlan({ dirty: false, failed: false }),
      fieldsDirty: deskFieldsDirty({ name: "Amina" }, { name: "Otieno" }),
      fieldsClean: deskFieldsDirty({ name: "Amina" }, { name: "Amina", extra: "new" }),
      usageCopy: shellPullErrorCopy("/wallet"),
      ticketCopy: shellPullErrorCopy("/calls/abc"),
      contactCopy: shellPullErrorCopy("/contacts/abc"),
      profileCopy: shellPullErrorCopy("/settings"),
      homeCopy: shellPullErrorCopy("/home"),
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
    assert.equal(out.phone, true);
    assert.equal(out.nudge, false);
    assert.equal(out.scrolled, false);
    assert.equal(out.sideways, false);
    assert.equal(out.desktop, false);
    assert.equal(out.kept, false);
    assert.deepEqual(out.keptIds, ["a", "b"]);
    assert.equal(out.fresh, true);
    assert.deepEqual(out.freshIds, ["c"]);
    assert.equal(out.deskTop, 0);
    assert.equal(out.paneTop, 40);
    assert.equal(out.paneClear, 0);
    assert.equal(out.skipDirty, "skip");
    assert.equal(out.keepFail, "keep");
    assert.equal(out.refreshClean, "refresh");
    assert.equal(out.fieldsDirty, true);
    assert.equal(out.fieldsClean, false);
    assert.equal(out.usageCopy, "Could not load Usage.");
    assert.equal(out.ticketCopy, "Could not load this call.");
    assert.equal(out.contactCopy, "Could not load this contact.");
    assert.equal(out.profileCopy, "Could not load Business Profile.");
    assert.equal(out.homeCopy, "Could not load Overview.");
  });

  it("keeps one contacts row at every width, with a quiet loading row", () => {
    const list = read("dashboard/src/components/ContactsEndlessList.tsx");
    const sentinel = read("dashboard/src/components/EndlessList.tsx");
    assert.match(list, /ContactPhoneRow/);
    assert.doesNotMatch(list, /ContactTableRow/);
    assert.doesNotMatch(list, /DeskDataTable/);
    assert.doesNotMatch(list, /md:hidden|lg:hidden/);
    assert.match(list, /list-none overflow-hidden rounded-2xl border border-line bg-surface/);
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

  it("pulls to refresh the phone list and keeps rows when the reload fails", () => {
    const list = read("dashboard/src/components/ContactsEndlessList.tsx");
    const nav = read("dashboard/src/components/InboxPileNav.tsx");
    const board = read("dashboard/src/components/InboxPileBoard.tsx");
    const pull = read("dashboard/src/components/PhonePullRefresh.tsx");
    const page = read("dashboard/src/app/(desk)/contacts/page.tsx");
    assert.match(pull, /max-width: 767px/);
    assert.match(pull, /pullRefreshCommit/);
    assert.match(pull, /md:hidden/);
    assert.match(pull, /getClientRects/);
    assert.match(pull, /Loading/);
    assert.match(list, /listAfterPullRefresh/);
    assert.match(list, /Could not load contacts\./);
    assert.match(list, /loadContactsSlice\(\{ page: 1/);
    assert.match(list, /setEpoch/);
    assert.match(list, /DeskError/);
    assert.match(page, /ContactsPullHost/);
    assert.match(nav, /refreshInboxList/);
    assert.match(nav, /Could not load inbox\./);
    assert.match(nav, /listAfterPullRefresh/);
    assert.match(nav, /setShown\(DEFAULT_PAGE_SIZE\)/);
    assert.match(board, /usePhoneListPull/);
    assert.match(board, /data-pull-root/);
    assert.doesNotMatch(pull, /[\u2014\u2013]/);
    assert.doesNotMatch(list, /Pull to refresh/);
    assert.doesNotMatch(pull, /location\.reload/);
    const surface = read("dashboard/src/components/PhonePullSurface.tsx");
    const action = read("dashboard/src/lib/deskPullAction.ts");
    assert.match(read("dashboard/src/app/(desk)/layout.tsx"), /DeskPhonePull/);
    assert.match(read("dashboard/src/app/admin/(console)/layout.tsx"), /AdminPhonePull/);
    assert.match(read("dashboard/src/app/admin/(console)/layout.tsx"), /data-admin-main/);
    assert.match(surface, /router\.refresh\(\)/);
    assert.match(surface, /shellPullPlan/);
    assert.match(surface, /data-pull-dirty-guard/);
    assert.match(surface, /visibleOwnedPullRoot|data-pull-root/);
    assert.doesNotMatch(surface, /location\.reload/);
    assert.doesNotMatch(surface, /[\u2014\u2013]/);
    assert.match(action, /revalidatePath/);
    assert.doesNotMatch(action, /topup|payment/i);
    assert.match(read("dashboard/src/components/BusinessSettingsShell.tsx"), /data-pull-dirty-guard/);
    assert.match(read("dashboard/src/components/InboxTicketView.tsx"), /data-pull-scroll/);
    assert.match(read("dashboard/src/lib/deskTicketChat.ts"), /\/dev\/ticket/);
    assert.doesNotMatch(read("dashboard/src/app/(desk)/wallet/page.tsx"), /location\.reload/);
  });
});
