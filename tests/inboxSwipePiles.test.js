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
      nextPurpose,
      prevPurpose,
      swipePileCommit,
      purposeAfterSwipe,
      inboxPileHref,
    } from ${JSON.stringify(helperPath)};
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
});

describe("inbox swipe wiring", () => {
  const helper = read("dashboard/src/lib/inboxSwipe.ts");
  const swipe = read("dashboard/src/components/InboxPileSwipe.tsx");
  const pills = read("dashboard/src/components/InboxFilterPills.tsx");
  const toolbar = read("dashboard/src/components/InboxToolbar.tsx");
  const page = read("dashboard/src/app/(desk)/calls/page.tsx");
  const niche = read("dashboard/src/lib/inboxNiche.ts");

  it("swipes one list with touch, chips stay the map, no max-md gate", () => {
    assert.match(swipe, /pointerType !== "touch"/);
    assert.match(swipe, /swipePileCommit/);
    assert.match(swipe, /router\.push/);
    assert.match(swipe, /ui\?\.selecting/);
    assert.match(swipe, /deskShiftClass/);
    assert.match(swipe, /touch-pan-y/);
    assert.doesNotMatch(swipe, /max-md/);
    assert.doesNotMatch(swipe, /framer-motion|lottie|gsap/i);
    assert.match(page, /<InboxPileSwipe/);
    assert.match(page, /<InboxToolbar/);
    const toolbarAt = page.indexOf("<InboxToolbar");
    const swipeAt = page.indexOf("<InboxPileSwipe");
    assert.ok(toolbarAt >= 0 && swipeAt > toolbarAt, "swipe the list, not the chips");
    assert.equal((page.match(/<DeskLandScope/g) || []).length, 1);
    assert.doesNotMatch(page, /SWIPE_PILES\.map\([\s\S]{0,300}<ul/);
    assert.match(page, /inboxPileHref\(id, pileHrefOpts\)/);
    assert.doesNotMatch(page, /max-md/);
    assert.match(page, /scopeKey=\{`\$\{activeFilter\}:\$\{page\}:\$\{q\}`\}/);
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
