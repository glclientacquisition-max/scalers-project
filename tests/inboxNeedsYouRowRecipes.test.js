const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

/**
 * Needs you Action dock recipes. Keep in lockstep with
 * dashboard/src/lib/inboxListVerbs.ts inboxListDockRecipe.
 */
function read(rel) {
  return fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
}

function item(partial) {
  return {
    id: "x",
    createdAt: "2026-09-20T08:00:00.000Z",
    purpose: "human",
    needsYou: true,
    callerName: "Amina",
    callerPhone: "254700000001",
    contactId: null,
    headline: "Asked for a person",
    detail: null,
    callId: "call-1",
    lead: { leadStatus: "new" },
    hold: null,
    job: null,
    intent: "human",
    urgent: false,
    unread: false,
    muted: false,
    pinnedAt: null,
    assignee: null,
    labels: [],
    snoozedUntil: null,
    ...partial,
  };
}

function itemIsArchived(row) {
  return row.lead?.leadStatus === "archived";
}

function inboxCanConfirm(row) {
  if (itemIsArchived(row)) return false;
  return String(row.job?.status || "").toLowerCase() === "requested";
}

function inboxCanVisitDone(row) {
  if (itemIsArchived(row)) return false;
  return String(row.job?.status || "").toLowerCase() === "confirmed";
}

function inboxCanHoldDone(row) {
  if (itemIsArchived(row)) return false;
  return String(row.hold?.status || "").toLowerCase() === "open";
}

function inboxListDockRecipe(row) {
  if (itemIsArchived(row)) {
    return row.callerPhone ? "call_wa" : "none";
  }
  if (inboxCanConfirm(row)) return "confirm";
  if (inboxCanVisitDone(row)) return "visit_done";
  if (inboxCanHoldDone(row)) return "hold_done";
  if (row.callerPhone) return "call_wa";
  return "none";
}

describe("Needs you row recipes", () => {
  it("maps visit, hold, return, and intent-only to one honest dock", () => {
    const visit = item({
      purpose: "job",
      intent: "book_visit",
      job: { id: "job-1", status: "requested" },
    });
    const hold = item({
      purpose: "hold",
      intent: "hold_or_pickup",
      hold: { id: "hold-1", status: "open" },
    });
    const human = item({ purpose: "human", intent: "human" });
    const missed = item({ purpose: "missed", intent: "missed" });
    const visitIntent = item({
      purpose: "job",
      intent: "book_visit",
      job: null,
    });
    const holdIntent = item({
      purpose: "hold",
      intent: "hold_or_pickup",
      hold: null,
    });
    const visitIntentSilent = item({
      purpose: "job",
      intent: "book_visit",
      job: null,
      callerPhone: null,
    });

    assert.equal(inboxListDockRecipe(visit), "confirm");
    assert.equal(inboxListDockRecipe(hold), "hold_done");
    assert.equal(inboxListDockRecipe(human), "call_wa");
    assert.equal(inboxListDockRecipe(missed), "call_wa");
    assert.equal(inboxListDockRecipe(visitIntent), "call_wa");
    assert.equal(inboxListDockRecipe(holdIntent), "call_wa");
    assert.equal(inboxListDockRecipe(visitIntentSilent), "none");
    assert.notEqual(inboxListDockRecipe(visitIntent), "confirm");
    assert.notEqual(inboxListDockRecipe(holdIntent), "hold_done");
  });

  it("never offers Confirm or hold Done on archived or leftover job/hold rows", () => {
    const archivedVisit = item({
      purpose: "job",
      job: { id: "job-1", status: "requested" },
      lead: { leadStatus: "archived" },
    });
    const archivedHold = item({
      purpose: "hold",
      hold: { id: "hold-1", status: "open" },
      lead: { leadStatus: "archived" },
    });
    const cancelledVisit = item({
      purpose: "job",
      needsYou: false,
      job: { id: "job-1", status: "cancelled" },
    });
    const cancelledHold = item({
      purpose: "hold",
      needsYou: false,
      hold: { id: "hold-1", status: "cancelled" },
    });
    const confirmedVisit = item({
      purpose: "job",
      needsYou: false,
      job: { id: "job-1", status: "confirmed" },
    });

    assert.equal(inboxListDockRecipe(archivedVisit), "call_wa");
    assert.equal(inboxListDockRecipe(archivedHold), "call_wa");
    assert.equal(inboxListDockRecipe(cancelledVisit), "call_wa");
    assert.equal(inboxListDockRecipe(cancelledHold), "call_wa");
    assert.equal(inboxListDockRecipe(confirmedVisit), "visit_done");
    assert.notEqual(inboxListDockRecipe(archivedVisit), "confirm");
    assert.notEqual(inboxListDockRecipe(archivedHold), "hold_done");
  });

  it("ships the recipe next to the existing Confirm and hold Done gates", () => {
    const verbs = read("dashboard/src/lib/inboxListVerbs.ts");
    assert.match(verbs, /export function inboxListDockRecipe/);
    assert.match(verbs, /export function inboxCanVisitDone/);
    assert.match(verbs, /if \(inboxCanConfirm\(item\)\) return "confirm"/);
    assert.match(verbs, /if \(inboxCanVisitDone\(item\)\) return "visit_done"/);
    assert.match(verbs, /if \(inboxCanHoldDone\(item\)\) return "hold_done"/);
    assert.match(verbs, /return item.callerPhone \? "call_wa" : "none"/);
    assert.doesNotMatch(verbs, /lead_status:\s*"resolved"/);
    assert.doesNotMatch(verbs, /notifyChannels/);
  });

  it("mounts list Confirm, hold Done, and Call plus WhatsApp only through the recipe", () => {
    const row = read("dashboard/src/components/InboxItemRow.tsx");
    const trailing = row.slice(
      row.indexOf("function InboxTrailingAction"),
      row.indexOf("export function InboxTableRow")
    );
    assert.match(trailing, /inboxListDockRecipe\(item\)/);
    assert.match(trailing, /recipe === "confirm" \|\| recipe === "visit_done"/);
    assert.match(trailing, /recipe === "hold_done"/);
    assert.match(trailing, /recipe === "call_wa"/);
    assert.match(trailing, /InboxJobActions id=\{item.job.id\} status=\{item.job.status\} extra=\{false\}/);
    assert.match(trailing, /RequestStatusToggle id=\{item.hold.id\} status=\{item.hold.status\} extra=\{false\}/);
    assert.match(trailing, /<CallLink number=\{item.callerPhone\} \/>/);
    assert.match(trailing, /variant="icon"/);
    assert.doesNotMatch(trailing, /if \(itemIsArchived\(item\)\)/);
    assert.doesNotMatch(trailing, /if \(item.job\)/);
    assert.doesNotMatch(trailing, /if \(item.hold\)/);
    assert.doesNotMatch(trailing, /Send SMS|mailto:/);
    assert.doesNotMatch(trailing, /updateLeadStatus/);
  });

  it("keeps ticket Confirm and hold Done on banners, not this list recipe", () => {
    const ticket = read("dashboard/src/components/InboxTicketView.tsx");
    const dock = read("dashboard/src/components/InboxTicketActionDock.tsx");
    assert.match(ticket, /InboxJobActions id=\{job.id\} status=\{job.status\} banner/);
    assert.match(ticket, /RequestStatusToggle id=\{hold.id\} status=\{hold.status\} banner/);
    assert.doesNotMatch(dock, /inboxListDockRecipe/);
    assert.doesNotMatch(dock, /InboxJobActions/);
    assert.doesNotMatch(dock, /RequestStatusToggle/);
  });
});
