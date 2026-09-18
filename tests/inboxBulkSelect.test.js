const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

function read(rel) {
  return fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
}

function item(partial) {
  return {
    id: "x",
    createdAt: "2026-09-12T05:10:00.000Z",
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

function inboxCanConfirm(row) {
  if (row.lead?.leadStatus === "archived") return false;
  return String(row.job?.status || "").toLowerCase() === "requested";
}

function inboxCanHoldDone(row) {
  if (row.lead?.leadStatus === "archived") return false;
  return String(row.hold?.status || "").toLowerCase() === "open";
}

function inboxBulkSharedAction(items) {
  if (!items.length) return null;
  if (items.every(inboxCanConfirm)) return "confirm";
  if (items.every(inboxCanHoldDone)) return "done";
  return null;
}

describe("inbox bulk select", () => {
  const select = read("dashboard/src/components/InboxRowSelect.tsx");
  const ui = read("dashboard/src/components/InboxRowUi.tsx");
  const overflow = read("dashboard/src/components/InboxRowOverflow.tsx");
  const actions = read("dashboard/src/lib/inboxLeadActions.ts");
  const verbs = read("dashboard/src/lib/inboxListVerbs.ts");

  it("enters selection from a hover checkbox or touch long-press", () => {
    assert.match(select, /type="checkbox"/);
    assert.match(select, /sr-only/);
    assert.match(select, /Select \{who\}/);
    assert.doesNotMatch(verbs, /id: "select"/);
    assert.match(overflow, /inboxOverflowActions\(item\)/);
    assert.match(overflow, /ui\?\.enter\(item\.id\)/);
    assert.match(ui, /enter:/);
    assert.match(ui, /toggle:/);
  });

  it("loops the same per-row handlers for bulk Archive, Confirm, and hold Done", () => {
    assert.match(select, /for \(const item of chosen\)/);
    assert.match(select, /inboxArchive\(item\)/);
    assert.match(select, /inboxConfirm\(item\)/);
    assert.match(select, /inboxHoldDone\(item\)/);
    assert.doesNotMatch(select, /inboxMarkDone/);
    assert.doesNotMatch(select, /inboxUnarchive/);
    assert.doesNotMatch(select, /inboxTogglePin/);
    assert.doesNotMatch(select, /inboxDelete/);
    assert.doesNotMatch(select, /inboxToggleRead/);
    assert.doesNotMatch(select, /inboxSnooze/);
    assert.match(actions, /updateLeadStatus\(item\.callId, "archived"\)/);
    assert.match(actions, /status", "confirmed"/);
    assert.match(actions, /status", "fulfilled"/);
    assert.match(select, />\s*Cancel\s*</);
    assert.match(select, /\{chosen\.length\} selected/);
  });

  it("shows a phone action bar with count and Archive", () => {
    assert.match(select, /aria-label="Back"/);
    assert.match(select, /aria-label="Archive"/);
    assert.doesNotMatch(select, /aria-label=\{allPinned/);
    assert.doesNotMatch(select, /aria-label="Mark done"/);
    assert.doesNotMatch(select, /aria-label="More"/);
    assert.doesNotMatch(select, /role="dialog"/);
    assert.match(select, /md:hidden/);
    assert.match(select, /hidden md:flex|md:flex md:static/);
    assert.match(select, /max-md:hidden/);
    assert.match(select, /kind === "archive"/);
    assert.doesNotMatch(select, /kind === "unarchive"/);
  });

  it("toggles the row instead of opening the ticket while selecting", () => {
    assert.match(select, /Toggle selection/);
    assert.match(select, /ui\.selecting/);
    assert.match(overflow, /if \(ui\?\.selecting\) return;/);
  });

  it("offers Confirm or Done only when every selected row shares that action", () => {
    assert.match(verbs, /export function inboxBulkSharedAction/);
    assert.match(verbs, /items\.every\(inboxCanConfirm\)/);
    assert.match(verbs, /items\.every\(inboxCanHoldDone\)/);
    assert.match(select, /inboxBulkSharedAction\(chosen\)/);
    assert.match(select, /status \|\| ""\)\.toLowerCase\(\) !== "requested"/);
    assert.match(select, /status \|\| ""\)\.toLowerCase\(\) !== "open"/);
    const visits = [
      item({ id: "a", job: { id: "j1", status: "requested" } }),
      item({ id: "b", job: { id: "j2", status: "requested" } }),
    ];
    const mixed = [
      item({ id: "a", job: { id: "j1", status: "requested" } }),
      item({ id: "c", purpose: "human" }),
    ];
    const holds = [
      item({ id: "h1", hold: { id: "s1", status: "open" } }),
      item({ id: "h2", hold: { id: "s2", status: "open" } }),
    ];
    assert.equal(inboxBulkSharedAction(visits), "confirm");
    assert.equal(inboxBulkSharedAction(mixed), null);
    assert.equal(inboxBulkSharedAction(holds), "done");
    assert.equal(inboxCanConfirm(item({ purpose: "human" })), false);
  });
});
