/**
 * Inbox chip taps switch the pile on the client (preview 18 Oct: every tab showed
 * the same 25 rows after the background prefetch was removed).
 * Run: node --experimental-strip-types --no-warnings --test tests/inboxTabSwitch.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { canClientSwitchPile, filterCachedPile } from "../dashboard/src/lib/inboxSwipe.ts";
import { nextShown, showMoreLabel } from "../dashboard/src/lib/endlessList.ts";
import {
  itemIsOpenHold,
  itemIsOpenVisit,
  itemIsToReturn,
  itemNeedsYouNow,
  type CountableItem,
} from "../dashboard/src/lib/inboxCounts.ts";

const NOW = Date.parse("2026-10-18T07:00:00Z");
const at = new Date(NOW - 3600_000).toISOString();
const many = (n: number, item: CountableItem) => Array.from({ length: n }, () => ({ ...item }));
// D&D-shaped: 22 visits, 60 to return, a few holds.
const items: CountableItem[] = [
  ...many(22, { purpose: "job", needsYou: true, createdAt: at, job: { status: "requested" } }),
  ...many(60, { purpose: "human", needsYou: true, createdAt: at }),
  ...many(3, { purpose: "hold", needsYou: true, createdAt: at, hold: { status: "open", request_type: "hold" } }),
];
const match = (item: CountableItem, pile: string) =>
  pile === "job" ? itemIsOpenVisit(item)
  : pile === "hold" ? itemIsOpenHold(item)
  : pile === "human" ? itemIsToReturn(item, NOW)
  : pile === "needs" ? itemNeedsYouNow(item, NOW)
  : true;

const HREFS = { needs: "/calls?purpose=needs", job: "/calls?purpose=job", hold: "/calls?purpose=hold", human: "/calls?purpose=human" };

describe("Inbox tab switch", () => {
  it("each pile filters the loaded list to its own rows", () => {
    assert.equal(filterCachedPile(items, "job", match).rows.length, 22);
    assert.equal(filterCachedPile(items, "human", match).rows.length, 60);
    assert.equal(filterCachedPile(items, "hold", match).rows.length, 3);
    assert.equal(filterCachedPile(items, "needs", match).rows.length, 85);
  });

  it("chip taps switch on the client in list mode only", () => {
    assert.equal(canClientSwitchPile("job", HREFS.job, HREFS, true), true);
    assert.equal(canClientSwitchPile("job", HREFS.job, HREFS, false), false);
    assert.equal(canClientSwitchPile("archived", "/calls?purpose=archived", { ...HREFS, archived: "x" }, true), false);
    assert.equal(canClientSwitchPile("job", "/calls?purpose=job&view=week", HREFS, true), false);
    assert.equal(canClientSwitchPile("visits", "/calls?purpose=visits", HREFS, true), false);
  });

  it("the Inbox chips call goPile (filter at once) and Segmented skips the Link navigation", () => {
    const pills = readFileSync("dashboard/src/components/InboxFilterPills.tsx", "utf8");
    assert.match(pills, /useInboxPileNav\(\)/);
    assert.match(pills, /nav\.goPile\(key\)/);
    assert.match(pills, /canClientSwitchPile\(/);
    const seg = readFileSync("dashboard/src/components/ui/Segmented.tsx", "utf8");
    assert.match(seg, /if \(onNavigate\(item\.key\)\) event\.preventDefault\(\)/);
    const nav = readFileSync("dashboard/src/components/InboxPileNav.tsx", "utf8");
    assert.match(nav, /setLocalPurpose\(next as InboxPurposeFilterId\)/);
    assert.match(nav, /itemMatchesPurpose\(item, pile as InboxPurposeFilterId\)/);
  });

  it("a long pile grows 25 at a time with a visible Show more until all rows show", () => {
    const total = filterCachedPile(items, "human", match).rows.length; // 60 return calls
    let shown = 25;
    assert.equal(showMoreLabel(shown, total), "Show more · 35 left");
    shown = nextShown(shown, total, 25);
    assert.equal(shown, 50);
    assert.equal(showMoreLabel(shown, total), "Show more · 10 left");
    shown = nextShown(shown, total, 25);
    assert.equal(shown, 60);
    assert.equal(showMoreLabel(shown, total), null);
    assert.equal(showMoreLabel(3, 3), null);
  });

  it("the board renders Show more off the client-filtered pile, and a tab switch resets to 25", () => {
    const board = readFileSync("dashboard/src/components/InboxPileBoard.tsx", "utf8");
    assert.match(board, /nav\.hasMore \? \(/);
    assert.match(board, /onClick=\{nav\.loadMore\}/);
    assert.match(board, /showMoreLabel\(pageRows\.length, nav\.listed\.length\)/);
    const nav = readFileSync("dashboard/src/components/InboxPileNav.tsx", "utf8");
    assert.match(nav, /const filterKey = `\$\{localPurpose\}/);
    assert.match(nav, /setShown\(DEFAULT_PAGE_SIZE\)/);
    assert.match(nav, /listed\.slice\(0, windowCount\)/);
  });

  it("a client tab switch rewrites the address bar without a server render", () => {
    const nav = readFileSync("dashboard/src/components/InboxPileNav.tsx", "utf8");
    const go = nav.slice(nav.indexOf("const goPile"), nav.indexOf("const setQuery"));
    assert.match(go, /canClientSwitchPile\(next, href, hrefsRef\.current, enableSelect\)/);
    assert.match(go, /window\.history\.replaceState\(null, "", href\);\s*return;/);
    // Board views (view=week/today) still go through the server.
    assert.match(go, /if \(href\) router\.replace\(href\)/);
    assert.ok(go.indexOf("replaceState") < go.indexOf("router.replace"));
    // List mode does not prefetch adjacent tabs (each one is a full server render).
    assert.match(nav, /if \(enableSelect\) return;\s*const \{ next, prev \} = adjacentPileHrefs/);
  });
});
