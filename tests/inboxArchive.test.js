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

function inboxOverflowActions(row) {
  if (itemIsArchived(row)) return [{ id: "unarchive", label: "Unarchive" }];
  return [{ id: "archive", label: "Archive" }];
}

function inboxBulkLeaveAction(items) {
  if (!items.length) return null;
  if (items.every(itemIsArchived)) return "unarchive";
  if (items.some(itemIsArchived)) return null;
  return "archive";
}

describe("inbox archive folder and leave verbs", () => {
  const verbs = read("dashboard/src/lib/inboxListVerbs.ts");
  const overflow = read("dashboard/src/components/InboxRowOverflow.tsx");
  const select = read("dashboard/src/components/InboxRowSelect.tsx");
  const ticket = read("dashboard/src/components/InboxTicketView.tsx");
  const row = read("dashboard/src/components/InboxItemRow.tsx");
  const folder = read("dashboard/src/components/InboxArchivedRow.tsx");
  const toolbar = read("dashboard/src/components/InboxToolbar.tsx");
  const actions = read("dashboard/src/lib/inboxLeadActions.ts");
  const page = read("dashboard/src/app/(desk)/calls/page.tsx");

  it("archives live rows and unarchives Archived rows through the same lead_status path", () => {
    assert.match(actions, /updateLeadStatus\(item\.callId, "archived"\)/);
    assert.match(actions, /updateLeadStatus\(item\.callId, "new"\)/);
    assert.match(overflow, /inboxArchive\(item\)/);
    assert.match(overflow, /inboxUnarchive\(item\)/);
    assert.match(verbs, /id: "unarchive"/);
    assert.match(verbs, /label: "Unarchive"/);
    assert.deepEqual(
      inboxOverflowActions(item({ lead: { leadStatus: "new" } })).map((verb) => verb.id),
      ["archive"]
    );
    assert.deepEqual(
      inboxOverflowActions(item({ lead: { leadStatus: "archived" } })).map((verb) => verb.id),
      ["unarchive"]
    );
  });

  it("bulk Archives live rows and Unarchives when every selected row is archived", () => {
    assert.match(verbs, /export function inboxBulkLeaveAction/);
    assert.match(select, /inboxBulkLeaveAction\(chosen\)/);
    assert.match(select, /inboxUnarchive\(item\)/);
    assert.match(select, /kind === "unarchive"/);
    assert.match(select, /aria-label="Unarchive"/);
    assert.match(select, />\s*Unarchive\s*</);
    const live = [item({ id: "a" }), item({ id: "b" })];
    const archived = [
      item({ id: "a", lead: { leadStatus: "archived" } }),
      item({ id: "b", lead: { leadStatus: "archived" } }),
    ];
    const mixed = [item({ id: "a" }), item({ id: "b", lead: { leadStatus: "archived" } })];
    assert.equal(inboxBulkLeaveAction(live), "archive");
    assert.equal(inboxBulkLeaveAction(archived), "unarchive");
    assert.equal(inboxBulkLeaveAction(mixed), null);
    assert.equal(inboxBulkLeaveAction([]), null);
  });

  it("keeps ticket More as Archive, or Unarchive when archived, and stays on the ticket after Unarchive", () => {
    assert.match(ticket, /InboxTicketMore callId=\{callId\} backHref=\{backHref\} archived=\{archived\}/);
    assert.match(ticket, /archived \? "new" : "archived"/);
    assert.match(ticket, /archived \? "Unarchive" : "Archive"/);
    assert.match(ticket, /if \(!archived\) router\.push\(backHref\)/);
    assert.match(ticket, /!archived && String\(job\?\.status/);
    assert.match(ticket, /!archived && String\(hold\?\.status/);
    assert.doesNotMatch(ticket, /archived \? null : <InboxTicketMore/);
  });

  it("keeps Confirm and hold Done off archived list docks", () => {
    const trailing = row.slice(row.indexOf("function InboxTrailingAction"), row.indexOf("export function InboxTableRow"));
    assert.match(trailing, /itemIsArchived\(item\)/);
    assert.match(trailing, /CallLink/);
    assert.match(trailing, /WhatsAppLink/);
    const archivedDock = trailing.slice(trailing.indexOf("itemIsArchived"), trailing.indexOf("if (item.job)"));
    assert.doesNotMatch(archivedDock, /InboxJobActions/);
    assert.doesNotMatch(archivedDock, /RequestStatusToggle/);
  });

  it("keeps the Archived folder at 44px and restores the prior pile after search", () => {
    assert.match(folder, /h-11 w-11/);
    assert.match(folder, /min-h-12/);
    assert.match(folder, /tabular-nums/);
    assert.match(folder, /label="Archived"/);
    assert.match(page, /showArchivedEntry/);
    assert.match(toolbar, /inboxArchivedHref/);
    assert.match(toolbar, /page: rpage/);
  });
});
