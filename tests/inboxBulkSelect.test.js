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

function itemIsArchived(row) {
  return row.lead?.leadStatus === "archived";
}

function inboxCanConfirm(row) {
  if (itemIsArchived(row)) return false;
  return String(row.job?.status || "").toLowerCase() === "requested";
}

function inboxCanHoldDone(row) {
  if (itemIsArchived(row)) return false;
  return String(row.hold?.status || "").toLowerCase() === "open";
}

function inboxCanMarkDone(row) {
  if (itemIsArchived(row)) return false;
  if (row.job || row.hold) return false;
  if (row.purpose !== "human" && row.purpose !== "missed") return false;
  return String(row.lead?.leadStatus || "").toLowerCase() !== "resolved";
}

function inboxBulkLeaveAction(items) {
  if (!items.length) return null;
  if (items.every(itemIsArchived)) return "unarchive";
  if (items.some(itemIsArchived)) return null;
  return "archive";
}

function inboxBulkActions(items) {
  if (!items.length) return [];
  const out = [];
  const leave = inboxBulkLeaveAction(items);
  if (leave === "archive") out.push({ id: "archive", label: "Archive" });
  if (leave === "unarchive") out.push({ id: "unarchive", label: "Unarchive" });
  if (items.every(inboxCanConfirm)) out.push({ id: "confirm", label: "Confirm" });
  if (items.every(inboxCanHoldDone)) out.push({ id: "done", label: "Hold Done" });
  if (items.every(inboxCanMarkDone)) out.push({ id: "mark_done", label: "Mark done" });
  return out;
}

describe("inbox bulk select", () => {
  const select = read("dashboard/src/components/InboxRowSelect.tsx");
  const ui = read("dashboard/src/components/InboxRowUi.tsx");
  const overflow = read("dashboard/src/components/InboxRowOverflow.tsx");
  const actions = read("dashboard/src/lib/inboxLeadActions.ts");
  const verbs = read("dashboard/src/lib/inboxListVerbs.ts");

  it("enters selection from a desktop checkbox or touch long-press", () => {
    assert.match(select, /type="checkbox"/);
    assert.match(select, /sr-only/);
    assert.match(select, /Select \{who\}/);
    assert.match(select, /hidden md:inline-flex opacity-50/);
    assert.doesNotMatch(select, /hidden opacity-0/);
    assert.doesNotMatch(select, /group-hover:opacity-100/);
    assert.doesNotMatch(verbs, /id: "select"/);
    assert.match(overflow, /inboxOverflowActions\(item\)/);
    assert.match(overflow, /ui\?\.enter\(item\.id\)/);
    assert.match(ui, /enter:/);
    assert.match(ui, /toggle:/);
  });

  it("loops the same per-row handlers for bulk Archive, Confirm, hold Done, and Mark done", () => {
    assert.match(select, /for \(const item of chosen\)/);
    assert.match(select, /inboxArchive\(item\)/);
    assert.match(select, /inboxConfirm\(item\)/);
    assert.match(select, /inboxHoldDone\(item\)/);
    assert.match(select, /inboxMarkDone\(item\)/);
    assert.match(select, /inboxUnarchive\(item\)/);
    assert.doesNotMatch(select, /inboxTogglePin/);
    assert.doesNotMatch(select, /inboxDelete/);
    assert.doesNotMatch(select, /inboxToggleRead/);
    assert.doesNotMatch(select, /inboxSnooze/);
    assert.match(actions, /updateLeadStatus\(item\.callId, "archived"\)/);
    assert.match(actions, /status", "confirmed"/);
    assert.match(actions, /status", "fulfilled"/);
    assert.doesNotMatch(select, />\s*Cancel\s*</);
  });

  it("shows a header select bar with Close, count, and relevant verbs", () => {
    assert.match(select, /aria-label="Close"/);
    assert.doesNotMatch(select, /aria-label="Back"/);
    assert.match(select, /aria-label=\{action\.label\}/);
    assert.doesNotMatch(select, /aria-label=\{allPinned/);
    assert.doesNotMatch(select, /aria-label="More"/);
    assert.doesNotMatch(select, /role="dialog"/);
    assert.match(select, /className=\{ui\?\.selecting \? "hidden"/);
    assert.match(select, /kind === "archive"/);
    assert.match(select, /kind === "unarchive"/);
    assert.match(select, /kind === "mark_done"/);
    assert.match(select, /\{chosen\.length\}/);
    assert.doesNotMatch(select, /\{chosen\.length\} selected/);
    assert.doesNotMatch(select, /md:hidden/);
    assert.doesNotMatch(select, /hidden md:flex/);
  });

  it("toggles the row instead of opening the ticket while selecting", () => {
    assert.match(select, /Toggle selection/);
    assert.match(select, /ui\.selecting/);
    assert.match(overflow, /if \(ui\?\.selecting\) return;/);
  });

  it("offers Confirm, Hold Done, or Mark done only when every selected row shares that action", () => {
    assert.match(verbs, /export function inboxBulkActions/);
    assert.match(verbs, /export function inboxCanMarkDone/);
    assert.match(verbs, /items\.every\(inboxCanConfirm\)/);
    assert.match(verbs, /items\.every\(inboxCanHoldDone\)/);
    assert.match(verbs, /items\.every\(inboxCanMarkDone\)/);
    assert.match(select, /inboxBulkActions\(chosen\)/);
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
    const returns = [item({ id: "r1" }), item({ id: "r2", purpose: "missed" })];
    const archived = [
      item({ id: "a", lead: { leadStatus: "archived" } }),
      item({ id: "b", lead: { leadStatus: "archived" } }),
    ];
    const mixedArchive = [item({ id: "a" }), item({ id: "b", lead: { leadStatus: "archived" } })];
    assert.deepEqual(
      inboxBulkActions(visits).map((row) => row.id),
      ["archive", "confirm"]
    );
    assert.deepEqual(
      inboxBulkActions(holds).map((row) => row.id),
      ["archive", "done"]
    );
    assert.deepEqual(
      inboxBulkActions(returns).map((row) => row.id),
      ["archive", "mark_done"]
    );
    assert.deepEqual(
      inboxBulkActions(mixed).map((row) => row.id),
      ["archive"]
    );
    assert.deepEqual(
      inboxBulkActions(archived).map((row) => row.id),
      ["unarchive"]
    );
    assert.deepEqual(inboxBulkActions(mixedArchive).map((row) => row.id), []);
    assert.equal(inboxCanConfirm(item({ purpose: "human" })), false);
    assert.equal(inboxCanMarkDone(item({ job: { status: "requested" } })), false);
    assert.equal(inboxCanMarkDone(item({ hold: { status: "open" } })), false);
    assert.equal(inboxCanMarkDone(item({ purpose: "answered" })), false);
    assert.equal(inboxCanMarkDone(item({ lead: { leadStatus: "archived" } })), false);
  });
});
