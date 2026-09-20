const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

/**
 * Needs you next-step line. Keep in lockstep with
 * dashboard/src/lib/inboxListVerbs.ts inboxNeedsYouNextStep.
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

function itemInNeedsYouPile(row) {
  return Boolean(row.needsYou) && !itemIsArchived(row);
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

function nicheConfirmStamp(_vertical) {
  return "Confirm visit";
}

function inboxNeedsYouNextStep(row, vertical) {
  if (!itemInNeedsYouPile(row)) return null;
  if (row.purpose === "live") return null;
  const recipe = inboxListDockRecipe(row);
  if (recipe === "confirm") return nicheConfirmStamp(vertical);
  if (recipe === "hold_done") return "Hold Done";
  if (recipe === "call_wa") return "Call or WhatsApp";
  return null;
}

describe("Needs you whose-turn next-step", () => {
  it("maps visit, hold, return, and intent-only to one honest line", () => {
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

    assert.equal(inboxNeedsYouNextStep(visit), "Confirm visit");
    assert.equal(inboxNeedsYouNextStep(visit, "hospitality"), "Confirm visit");
    assert.equal(inboxNeedsYouNextStep(hold), "Hold Done");
    assert.equal(inboxNeedsYouNextStep(human), "Call or WhatsApp");
    assert.equal(inboxNeedsYouNextStep(missed), "Call or WhatsApp");
    assert.equal(inboxNeedsYouNextStep(visitIntent), "Call or WhatsApp");
    assert.equal(inboxNeedsYouNextStep(holdIntent), "Call or WhatsApp");
    assert.equal(inboxNeedsYouNextStep(visitIntentSilent), null);
    assert.doesNotMatch(inboxNeedsYouNextStep(visitIntent), /Confirm|Done/);
    assert.doesNotMatch(inboxNeedsYouNextStep(holdIntent), /Confirm|Done/);
  });

  it("omits the line on live, archived, confirmed, and leftover rows", () => {
    const live = item({ purpose: "live", headline: "On the line" });
    const archivedVisit = item({
      purpose: "job",
      needsYou: true,
      job: { id: "job-1", status: "requested" },
      lead: { leadStatus: "archived" },
    });
    const confirmedVisit = item({
      purpose: "job",
      needsYou: false,
      job: { id: "job-1", status: "confirmed" },
    });
    const cancelledHold = item({
      purpose: "hold",
      needsYou: false,
      hold: { id: "hold-1", status: "cancelled" },
    });
    const answered = item({
      purpose: "answered",
      needsYou: false,
      headline: "Hours",
    });

    assert.equal(inboxNeedsYouNextStep(live), null);
    assert.equal(inboxNeedsYouNextStep(archivedVisit), null);
    assert.equal(inboxNeedsYouNextStep(confirmedVisit), null);
    assert.equal(inboxNeedsYouNextStep(cancelledHold), null);
    assert.equal(inboxNeedsYouNextStep(answered), null);
  });

  it("ships the line next to the #364 dock recipe and existing Confirm copy", () => {
    const verbs = read("dashboard/src/lib/inboxListVerbs.ts");
    assert.match(verbs, /export function inboxNeedsYouNextStep/);
    assert.match(verbs, /if \(!itemInNeedsYouPile\(item\)\) return null/);
    assert.match(verbs, /if \(item.purpose === "live"\) return null/);
    assert.match(verbs, /inboxListDockRecipe\(item\)/);
    assert.match(verbs, /recipe === "confirm"[\s\S]*confirmStamp/);
    assert.match(verbs, /recipe === "hold_done"[\s\S]*"Hold Done"/);
    assert.match(verbs, /recipe === "call_wa"[\s\S]*"Call or WhatsApp"/);
    assert.doesNotMatch(verbs, /Your turn|Waiting on caller|Awaiting confirm/);
    assert.doesNotMatch(verbs, /lead_status:\s*"resolved"/);
    assert.doesNotMatch(verbs, /notifyChannels/);
    assert.match(read("dashboard/src/lib/inboxNiche.ts"), /confirmStamp: "Confirm visit"/);
    assert.match(read("dashboard/src/lib/inboxNiche.ts"), /HOSPITALITY_RESERVATIONS_EXIST = false/);
    assert.match(read("dashboard/src/lib/inboxNiche.ts"), /confirmStamp: "Confirm booking"/);
    assert.match(verbs, /label: "Hold Done"/);
  });

  it("mounts the line under the preview, not as a second dock verb", () => {
    const row = read("dashboard/src/components/InboxItemRow.tsx");
    assert.match(row, /inboxNeedsYouNextStep\(item, vertical\)/);
    assert.match(row, /function InboxNextStep/);
    assert.match(row, /text-xs text-ink-soft/);
    const trailing = row.slice(
      row.indexOf("function InboxTrailingAction"),
      row.indexOf("export function InboxTableRow")
    );
    assert.match(trailing, /inboxListDockRecipe\(item\)/);
    assert.doesNotMatch(trailing, /inboxNeedsYouNextStep/);
    assert.doesNotMatch(trailing, /InboxNextStep/);
    assert.doesNotMatch(row, /Your turn|Waiting on caller|Awaiting confirm/);
    assert.doesNotMatch(row, /updateLeadStatus/);
    assert.doesNotMatch(row, /line-clamp-2/);
  });
});
