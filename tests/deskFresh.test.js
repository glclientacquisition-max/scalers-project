// Desk freshness: usage credit, contacts page failure, open-ticket transcript.

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("node:child_process");

function read(rel) {
  return fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
}

function load() {
  const helperPath = path.join(__dirname, "../dashboard/src/lib/deskFresh.ts");
  const script = `
    import {
      usageLiveWatches,
      refreshUsageOnPaymentStart,
      usageRouteNeedsRefresh,
      contactsSliceOutcome,
      liveTicketFilter,
      transcriptRefreshTop,
    } from ${JSON.stringify(helperPath)};
    const watches = usageLiveWatches("ten-1");
    console.log(JSON.stringify({
      payStart: refreshUsageOnPaymentStart(),
      tenantTable: watches[0].table,
      tenantFilter: watches[0].filter,
      ledgerTable: watches[1].table,
      ledgerFilter: watches[1].filter,
      walletRoute: usageRouteNeedsRefresh("/wallet"),
      walletPage: usageRouteNeedsRefresh("/wallet?page=2"),
      homeRoute: usageRouteNeedsRefresh("/home"),
      callsRoute: usageRouteNeedsRefresh("/calls/abc"),
      settingsRoute: usageRouteNeedsRefresh("/settings"),
      fail: contactsSliceOutcome({ error: "Not signed in.", rowCount: 0 }),
      empty: contactsSliceOutcome({ error: null, rowCount: 0 }),
      more: contactsSliceOutcome({ error: null, rowCount: 25 }),
      ticket: liveTicketFilter("11111111-1111-4111-8111-111111111111"),
      badTicket: liveTicketFilter("../wallet"),
      pinned: transcriptRefreshTop({
        anchor: "latest",
        scrollTop: 500,
        scrollHeight: 1400,
        clientHeight: 400,
      }),
      older: transcriptRefreshTop({
        anchor: "older",
        scrollTop: 180,
        scrollHeight: 1400,
        clientHeight: 400,
      }),
      start: transcriptRefreshTop({
        anchor: "start",
        scrollTop: 180,
        scrollHeight: 1400,
        clientHeight: 400,
      }),
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

describe("usage balance refresh", () => {
  const out = load();

  it("does not refresh when payment starts", () => {
    const button = read("dashboard/src/components/WalletTopUpButton.tsx");
    const topup = read("dashboard/src/app/(desk)/wallet/topupActions.ts");
    assert.equal(out.payStart, false);
    assert.equal(refreshUsageOnPaymentStartSafe(button), false);
    assert.doesNotMatch(button, /router\.refresh/);
    assert.doesNotMatch(button, /location\.reload/);
    assert.match(topup, /Complete the payment on your phone to credit your balance/);
    assert.doesNotMatch(read("dashboard/src/lib/deskPullAction.ts"), /topup|payment/i);
    assert.match(read("dashboard/src/components/PhonePullSurface.tsx"), /router\.refresh\(\)/);
    assert.doesNotMatch(read("dashboard/src/app/(desk)/wallet/page.tsx"), /location\.reload/);
  });

  it("refreshes Usage and Home only after the credit or minute row changes", () => {
    const live = read("dashboard/src/components/LiveInbox.tsx");
    const actions = read("dashboard/src/app/(desk)/liveInboxActions.ts");
    const save = read("dashboard/src/app/(desk)/wallet/actions.ts");
    assert.equal(out.tenantTable, "tenants");
    assert.equal(out.tenantFilter, "id=eq.ten-1");
    assert.equal(out.ledgerTable, "wallet_ledger");
    assert.equal(out.ledgerFilter, "tenant_id=eq.ten-1");
    assert.equal(out.walletRoute, true);
    assert.equal(out.walletPage, true);
    assert.equal(out.homeRoute, true);
    assert.equal(out.callsRoute, false);
    assert.equal(out.settingsRoute, false);
    assert.match(live, /usageLiveWatches/);
    assert.match(live, /revalidateLiveUsage/);
    assert.match(live, /usageRouteNeedsRefresh/);
    assert.match(live, /REFRESH_DEBOUNCE_MS = 1200/);
    assert.doesNotMatch(live, /location\.reload/);
    assert.match(actions, /export async function revalidateLiveUsage/);
    assert.match(actions, /revalidatePath\("\/wallet", "layout"\)/);
    assert.match(actions, /revalidatePath\("\/home", "layout"\)/);
    assert.match(save, /revalidatePath\("\/wallet"\)/);
    assert.match(save, /revalidatePath\("\/home"\)/);
    assert.doesNotMatch(save, /[\u2014\u2013]/);
  });
});

function refreshUsageOnPaymentStartSafe(buttonSrc) {
  return /router\.refresh/.test(buttonSrc);
}

describe("contacts next page", () => {
  const out = load();

  it("keeps rows and shows the desk error when the next page fails", () => {
    const list = read("dashboard/src/components/ContactsEndlessList.tsx");
    assert.equal(out.fail, "retry");
    assert.equal(out.empty, "end");
    assert.equal(out.more, "append");
    assert.match(list, /contactsSliceOutcome/);
    assert.match(list, /Could not load contacts\./);
    assert.match(list, /hold=\{Boolean\(error\)\}/);
    assert.match(list, /DeskError/);
    assert.doesNotMatch(list, /res\.error \|\| res\.rows\.length === 0/);
    assert.doesNotMatch(list, /location\.reload/);
    assert.doesNotMatch(list, /[\u2014\u2013]/);
  });
});

describe("open ticket transcript", () => {
  const out = load();

  it("refreshes the open call without jumping a scrolled thread", () => {
    const ticket = read("dashboard/src/components/LiveTicket.tsx");
    const page = read("dashboard/src/app/(desk)/calls/[id]/page.tsx");
    const view = read("dashboard/src/components/InboxTicketView.tsx");
    assert.equal(out.ticket, "call_id=eq.11111111-1111-4111-8111-111111111111");
    assert.equal(out.badTicket, null);
    assert.equal(out.pinned, 1000);
    assert.equal(out.older, 180);
    assert.equal(out.start, 0);
    assert.ok(out.pinned > 500);
    assert.match(ticket, /table: "transcripts"/);
    assert.match(ticket, /liveTicketFilter/);
    assert.match(ticket, /revalidateLiveTicket/);
    assert.match(ticket, /routerRef\.current\.refresh\(\)/);
    assert.doesNotMatch(ticket, /location\.reload/);
    assert.match(page, /<LiveTicket callId=\{row\.id\} \/>/);
    assert.match(view, /transcriptRefreshTop/);
    assert.match(view, /data-thread-stick/);
    assert.doesNotMatch(view, /[\u2014\u2013]/);
    assert.equal(fs.existsSync(path.join(__dirname, "../dashboard/src/app/(desk)/loading.tsx")), false);
  });
});
