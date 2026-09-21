const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("fs");
const path = require("path");

const helperPath = path.join(__dirname, "../dashboard/src/lib/inboxSwipe.ts");

function read(rel) {
  return fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
}

function load() {
  const script = `
    import {
      SWIPE_PILES,
      INBOX_SWIPE_PX,
      INBOX_SWIPE_FOLLOW_CAP,
      nextPurpose,
      prevPurpose,
      swipePileCommit,
      purposeAfterSwipe,
      inboxPileHref,
      adjacentPileHrefs,
      inboxSwipeFollowPx,
      inboxSwipeCommitPx,
      filterCachedPile,
    } from ${JSON.stringify(helperPath)};
    const hrefs = {
      needs: "/calls?purpose=needs",
      all: "/calls?purpose=all",
      job: "/calls?purpose=job",
      hold: "/calls?purpose=hold",
      human: "/calls?purpose=human",
      answered: "/calls?purpose=answered",
    };
    const cases = {
      piles: [...SWIPE_PILES],
      threshold: INBOX_SWIPE_PX,
      order: {
        needsNext: nextPurpose("needs"),
        allNext: nextPurpose("all"),
        jobNext: nextPurpose("job"),
        holdNext: nextPurpose("hold"),
        humanNext: nextPurpose("human"),
        answeredNext: nextPurpose("answered"),
        needsPrev: prevPurpose("needs"),
        allPrev: prevPurpose("all"),
        answeredPrev: prevPurpose("answered"),
        holdPrev: prevPurpose("hold"),
      },
      archived: {
        next: nextPurpose("archived"),
        prev: prevPurpose("archived"),
        after: purposeAfterSwipe("archived", "next"),
      },
      mouse: swipePileCommit({ dx: -120, dy: 4, pointerType: "mouse" }),
      pen: swipePileCommit({ dx: -120, dy: 4, pointerType: "pen" }),
      selecting: swipePileCommit({
        dx: -120,
        dy: 4,
        pointerType: "touch",
        selecting: true,
      }),
      vertical: swipePileCommit({ dx: -80, dy: -90, pointerType: "touch" }),
      short: swipePileCommit({ dx: -20, dy: 2, pointerType: "touch" }),
      next: swipePileCommit({ dx: -80, dy: 10, pointerType: "touch" }),
      prev: swipePileCommit({ dx: 80, dy: 10, pointerType: "touch" }),
      afterNext: purposeAfterSwipe("needs", "next"),
      afterPrev: purposeAfterSwipe("all", "prev"),
      afterNull: purposeAfterSwipe("needs", null),
      hrefNeeds: inboxPileHref("needs", { active: "needs" }),
      hrefAllSearch: inboxPileHref("all", { active: "needs", q: "Amina" }),
      hrefJobFromNeeds: inboxPileHref("job", {
        active: "needs",
        view: "week",
        week: "2026-09-14",
      }),
      hrefJobWeek: inboxPileHref("job", {
        active: "job",
        view: "week",
        week: "2026-09-14",
        q: "Amina",
      }),
      hrefHoldToday: inboxPileHref("hold", {
        active: "hold",
        view: "today",
        day: "2026-09-18",
      }),
      hrefHuman: inboxPileHref("human", { active: "hold", view: "today", day: "2026-09-18" }),
      followCap: INBOX_SWIPE_FOLLOW_CAP,
      followOver: inboxSwipeFollowPx(400),
      followUnder: inboxSwipeFollowPx(-12),
      followZero: inboxSwipeFollowPx(0),
      commitNext: inboxSwipeCommitPx("next"),
      commitPrev: inboxSwipeCommitPx("prev"),
      adjNeeds: adjacentPileHrefs("needs", hrefs),
      adjAll: adjacentPileHrefs("all", hrefs),
      adjAnswered: adjacentPileHrefs("answered", hrefs),
      adjArchived: adjacentPileHrefs("archived", hrefs),
      paintPending: filterCachedPile(null, "all", () => true),
      paintEmpty: filterCachedPile([{ id: "a" }], "needs", () => false),
      paintRows: filterCachedPile(
        [{ id: "needs" }, { id: "other" }],
        "needs",
        (item, purpose) => item.id === purpose
      ),
    };
    console.log(JSON.stringify(cases));
  `;
  const ran = spawnSync(
    process.execPath,
    ["--experimental-strip-types", "--input-type=module", "-e", script],
    { encoding: "utf8" }
  );
  assert.equal(ran.status, 0, ran.stderr || ran.stdout);
  return JSON.parse(ran.stdout.trim().split("\n").at(-1));
}

describe("inbox swipe piles", () => {
  it("walks Needs you through Answered and skips Archived", () => {
    const { piles, order, archived } = load();
    assert.deepEqual(piles, ["needs", "all", "job", "hold", "human", "answered"]);
    assert.equal(order.needsNext, "all");
    assert.equal(order.allNext, "job");
    assert.equal(order.jobNext, "hold");
    assert.equal(order.holdNext, "human");
    assert.equal(order.humanNext, "answered");
    assert.equal(order.answeredNext, null);
    assert.equal(order.needsPrev, null);
    assert.equal(order.allPrev, "needs");
    assert.equal(order.holdPrev, "job");
    assert.equal(order.answeredPrev, "human");
    assert.equal(archived.next, null);
    assert.equal(archived.prev, null);
    assert.equal(archived.after, null);
    assert.equal(piles.includes("archived"), false);
  });

  it("commits only a dominant touch swipe, never mouse or bulk select", () => {
    const out = load();
    assert.equal(out.threshold, 64);
    assert.equal(out.mouse, null);
    assert.equal(out.pen, null);
    assert.equal(out.selecting, null);
    assert.equal(out.vertical, null);
    assert.equal(out.short, null);
    assert.equal(out.next, "next");
    assert.equal(out.prev, "prev");
    assert.equal(out.afterNext, "all");
    assert.equal(out.afterPrev, "needs");
    assert.equal(out.afterNull, null);
  });

  it("keeps chip hrefs on purpose= the same as tapping a pile", () => {
    const out = load();
    assert.equal(out.hrefNeeds, "/calls?purpose=needs");
    assert.equal(out.hrefAllSearch, "/calls?purpose=all&q=Amina");
    assert.equal(out.hrefJobFromNeeds, "/calls?purpose=job");
    assert.equal(out.hrefJobWeek, "/calls?purpose=job&q=Amina&view=week&week=2026-09-14");
    assert.equal(out.hrefHoldToday, "/calls?purpose=hold&view=today&day=2026-09-18");
    assert.equal(out.hrefHuman, "/calls?purpose=human");
  });

  it("prefetches next and prev hrefs and follows a capped dx", () => {
    const out = load();
    assert.equal(out.followCap, 96);
    assert.equal(out.followOver, 96);
    assert.equal(out.followUnder, -12);
    assert.equal(out.followZero, 0);
    assert.equal(out.commitNext, -120);
    assert.equal(out.commitPrev, 120);
    assert.equal(out.adjNeeds.next, "/calls?purpose=all");
    assert.equal(out.adjNeeds.prev, undefined);
    assert.equal(out.adjAll.next, "/calls?purpose=job");
    assert.equal(out.adjAll.prev, "/calls?purpose=needs");
    assert.equal(out.adjAnswered.next, undefined);
    assert.equal(out.adjAnswered.prev, "/calls?purpose=human");
    assert.equal(out.adjArchived.next, undefined);
    assert.equal(out.adjArchived.prev, undefined);
  });

  it("paints the next pile from cache without waiting, pending only with no cache", () => {
    const out = load();
    assert.equal(out.paintPending.paint, "pending");
    assert.deepEqual(out.paintPending.rows, []);
    assert.equal(out.paintEmpty.paint, "empty");
    assert.deepEqual(out.paintEmpty.rows, []);
    assert.equal(out.paintRows.paint, "rows");
    assert.deepEqual(out.paintRows.rows, [{ id: "needs" }]);
    assert.equal(out.mouse, null);
  });
});

describe("inbox swipe wiring", () => {
  const helper = read("dashboard/src/lib/inboxSwipe.ts");
  const swipe = read("dashboard/src/components/InboxPileSwipe.tsx");
  const nav = read("dashboard/src/components/InboxPileNav.tsx");
  const board = read("dashboard/src/components/InboxPileBoard.tsx");
  const pills = read("dashboard/src/components/InboxFilterPills.tsx");
  const toolbar = read("dashboard/src/components/InboxToolbar.tsx");
  const page = read("dashboard/src/app/(desk)/calls/page.tsx");
  const niche = read("dashboard/src/lib/inboxNiche.ts");

  it("swipes one list with touch, chips stay the map, no max-md gate", () => {
    assert.match(swipe, /pointerType !== "touch"/);
    assert.match(swipe, /swipePileCommit/);
    assert.match(swipe, /router\.replace/);
    assert.doesNotMatch(swipe, /router\.push/);
    assert.match(nav, /router\.replace/);
    assert.doesNotMatch(nav, /router\.push/);
    assert.doesNotMatch(nav, /await router\.replace/);
    assert.match(swipe, /ui\?\.selecting/);
    assert.match(swipe, /deskShiftClass/);
    assert.match(swipe, /touch-pan-y/);
    assert.match(swipe, /inboxSwipeFollowPx/);
    assert.doesNotMatch(swipe, /dx \* 0\.28/);
    assert.match(swipe, /transitionend/);
    assert.doesNotMatch(swipe, /max-md/);
    assert.doesNotMatch(swipe, /framer-motion|lottie|gsap|transition-all/i);
    assert.match(page, /<InboxPileNavProvider/);
    assert.match(page, /<InboxPileBoard/);
    assert.match(page, /<InboxToolbar/);
    assert.match(board, /<InboxPileSwipe/);
    const toolbarAt = page.indexOf("<InboxToolbar");
    const boardAt = page.indexOf("<InboxPileBoard");
    assert.ok(toolbarAt >= 0 && boardAt > toolbarAt, "swipe the list, not the chips");
    assert.equal((board.match(/<DeskLandScope/g) || []).length, 1);
    assert.doesNotMatch(page, /SWIPE_PILES\.map\([\s\S]{0,300}<ul/);
    assert.match(page, /inboxPileHref\(id, pileHrefOpts\)/);
    assert.doesNotMatch(page, /max-md/);
    assert.match(board, /scopeKey=\{`\$\{purpose\}:\$\{page\}:\$\{q\}`\}/);
  });

  it("replaces the URL after a client cache filter and prefetches next and prev", () => {
    assert.match(helper, /export function adjacentPileHrefs/);
    assert.match(helper, /export function filterCachedPile/);
    assert.match(swipe, /router\.prefetch/);
    assert.match(swipe, /adjacentPileHrefs/);
    assert.match(swipe, /prefetch/);
    assert.match(nav, /filterCachedPile/);
    assert.match(nav, /itemMatchesPurpose/);
    assert.match(nav, /router\.prefetch/);
    assert.match(pills, /prefetch/);
    assert.match(toolbar, /useInboxPileNav/);
    assert.match(nav, /itemMatchesQuery/);
    assert.match(page, /items=\{assembled\}/);
    assert.doesNotMatch(page, /<InboxPileNavProvider[\s\S]*?items=\{searched\}/);
    assert.doesNotMatch(nav, /async function goPile/);
    assert.match(board, /pendingSpinnerInkClass/);
    assert.match(board, /paint === "pending"/);
  });

  it("scrolls the active chip on a snap strip that never wraps", () => {
    assert.match(pills, /scrollIntoView/);
    assert.match(pills, /flex-nowrap/);
    assert.match(pills, /snap-x snap-mandatory/);
    assert.match(pills, /overflow-x-auto/);
    assert.match(pills, /bg-gradient-to-l from-surface/);
    assert.doesNotMatch(pills, /md:flex-wrap|md:overflow-visible|max-md/);
    assert.match(toolbar, /inboxPileHref\(item\.id/);
    const purposeCall = toolbar.match(/<InboxFilterPills[\s\S]*?\/>/);
    assert.ok(purposeCall, "purpose row is InboxFilterPills");
    assert.match(niche, /id: "needs"/);
    assert.match(niche, /id: "answered"/);
    assert.doesNotMatch(niche, /label: "Archived"/);
    assert.match(helper, /"archived"/);
  });
});
