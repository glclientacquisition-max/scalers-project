/**
 * Inbox chip taps switch the pile on the client (preview 18 Oct: every tab showed
 * the same 25 rows after the background prefetch was removed).
 * Run: node --experimental-strip-types --no-warnings --test tests/inboxTabSwitch.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { canClientSwitchPile, filterCachedPile } from "../dashboard/src/lib/inboxSwipe.ts";
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
});
