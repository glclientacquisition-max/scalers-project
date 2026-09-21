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

function inboxCanMarkDone(row) {
  if (itemIsArchived(row)) return false;
  if (row.job || row.hold) return false;
  if (row.purpose !== "human" && row.purpose !== "missed") return false;
  return String(row.lead?.leadStatus || "").toLowerCase() !== "resolved";
}

function inboxOverflowActions(row) {
  const stay = [row.pinnedAt ? { id: "unpin", label: "Unpin" } : { id: "pin", label: "Pin" }];
  if (inboxCanMarkDone(row)) stay.push({ id: "mark_done", label: "Mark done" });
  if (itemIsArchived(row)) return [...stay, { id: "unarchive", label: "Unarchive" }];
  return [...stay, { id: "archive", label: "Archive" }];
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
  const board = read("dashboard/src/components/InboxPileBoard.tsx");

  it("archives live rows and unarchives Archived rows through the same lead_status path", () => {
    assert.match(actions, /updateLeadStatus\(item\.callId, "archived"\)/);
    assert.match(actions, /updateLeadStatus\(item\.callId, "new"\)/);
    assert.match(overflow, /inboxArchive\(item\)/);
    assert.match(overflow, /inboxUnarchive\(item\)/);
    assert.match(verbs, /id: "unarchive"/);
    assert.match(verbs, /label: "Unarchive"/);
    assert.deepEqual(
      inboxOverflowActions(item({ lead: { leadStatus: "new" } })).map((verb) => verb.id),
      ["pin", "mark_done", "archive"]
    );
    assert.deepEqual(
      inboxOverflowActions(item({ lead: { leadStatus: "archived" } })).map((verb) => verb.id),
      ["pin", "unarchive"]
    );
  });

  it("bulk Archives live rows and Unarchives when every selected row is archived", () => {
    assert.match(verbs, /export function inboxBulkLeaveAction/);
    assert.match(select, /inboxBulkActions\(chosen\)/);
    assert.match(select, /inboxUnarchive\(item\)/);
    assert.match(select, /kind === "unarchive"/);
    assert.match(select, /aria-label=\{action\.label\}/);
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
    assert.match(ticket, /<InboxTicketMore/);
    assert.match(ticket, /archived=\{archived\}/);
    assert.match(ticket, /<InboxTicketActionDock/);
    assert.match(ticket, /canMarkDone=\{canMarkDone\}/);
    assert.match(ticket, /id === "unarchive" \|\| archived \? "new" : "archived"/);
    assert.match(ticket, /action\.label/);
    assert.match(ticket, /writeInboxArchiveUndo\(\[\{ id: callId, callId \}\]\)/);
    assert.match(ticket, /id === "archive" && !archived/);
    assert.match(ticket, /router\.push\(backHref\)/);
    assert.match(ticket, /!archived && String\(job\?\.status/);
    assert.match(ticket, /!archived && String\(hold\?\.status/);
    assert.doesNotMatch(ticket, /archived \? null : <InboxTicketMore/);
  });

  it("keeps Confirm and hold Done off archived list docks", () => {
    const trailing = row.slice(row.indexOf("function InboxTrailingAction"), row.indexOf("export function InboxTableRow"));
    const verbs = read("dashboard/src/lib/inboxListVerbs.ts");
    assert.match(trailing, /inboxListDockRecipe\(item\)/);
    assert.match(trailing, /CallLink/);
    assert.match(trailing, /WhatsAppLink/);
    assert.match(verbs, /if \(itemIsArchived\(item\)\) \{\s*return item.callerPhone \? "call_wa" : "none"/);
    assert.match(trailing, /recipe === "confirm" \|\| recipe === "visit_done"/);
    assert.match(trailing, /recipe === "hold_done"/);
    const callWa = trailing.slice(trailing.indexOf('recipe === "call_wa"'));
    assert.doesNotMatch(callWa, /InboxJobActions/);
    assert.doesNotMatch(callWa, /RequestStatusToggle/);
  });

  it("keeps the Archived folder at 44px and restores the prior pile after search", () => {
    const nav = read("dashboard/src/components/InboxPileNav.tsx");
    assert.match(folder, /h-11 w-11/);
    assert.match(folder, /min-h-12/);
    assert.match(folder, /tabular-nums/);
    assert.match(folder, /label="Archived"/);
    assert.match(board, /showArchivedEntry/);
    assert.match(nav, /inboxArchivedHref/);
    assert.match(nav, /page: opts.rpage/);
    assert.match(toolbar, /name="from"/);
    assert.match(toolbar, /name="rpage"/);
  });

  it("offers a 5s Undo toast after Archive and not after Unarchive", () => {
    const undo = read("dashboard/src/lib/inboxArchiveUndo.ts");
    const toast = read("dashboard/src/components/InboxArchiveToast.tsx");
    const notice = read("dashboard/src/components/ui/DeskNotice.tsx");
    const ui = read("dashboard/src/components/InboxRowUi.tsx");
    assert.match(undo, /INBOX_ARCHIVE_UNDO_MS = 5000/);
    assert.match(undo, /scalers-inbox-archive-undo/);
    assert.match(undo, /count <= 1\) return "Archived"/);
    assert.match(undo, /return `\${count} archived`/);
    assert.match(toast, /text-accent-deep/);
    assert.match(toast, /min-h-11/);
    assert.match(toast, /busy \? "Saving" : "Undo"/);
    assert.match(toast, /updateLeadStatus\(row\.callId, "new"\)/);
    assert.match(toast, /DeskNotice open=\{!!notice\}/);
    assert.match(notice, /z-30/);
    assert.match(notice, /desk-tabbar-h/);
    assert.doesNotMatch(toast, /btnPrimary|btnDock|bg-accent-fill/);
    assert.match(ui, /InboxArchiveToast/);
    assert.match(ui, /INBOX_ARCHIVE_UNDO_EVENT/);
    assert.match(overflow, /if \(id === "archive" && item.callId\) \{\s*writeInboxArchiveUndo/);
    assert.match(select, /writeInboxArchiveUndo\(archivedRows\)/);
    assert.match(select, /kind === "archive" && item.callId/);
    assert.match(ticket, /writeInboxArchiveUndo\(\[\{ id: callId, callId \}\]\)/);
    assert.match(ticket, /id === "archive" && !archived/);
    assert.match(ticket, /router\.push\(backHref\)/);
  });
});

describe("inbox archive undo payload", () => {
  function load() {
    const helperPath = path.join(__dirname, "../dashboard/src/lib/inboxArchiveUndo.ts");
    const script = `
      import {
        INBOX_ARCHIVE_UNDO_MS,
        INBOX_ARCHIVE_UNDO_KEY,
        inboxArchiveUndoLabel,
        writeInboxArchiveUndo,
        readInboxArchiveUndo,
        parseInboxArchiveUndo,
        clearInboxArchiveUndo,
      } from ${JSON.stringify(helperPath)};
      const store = {
        data: new Map(),
        getItem(key) { return this.data.has(key) ? this.data.get(key) : null; },
        setItem(key, value) { this.data.set(key, value); },
        removeItem(key) { this.data.delete(key); },
      };
      const now = 1_000_000;
      const written = writeInboxArchiveUndo([{ id: "row-1", callId: "call-1" }], now, store);
      const fresh = readInboxArchiveUndo(now + 1000, store);
      const replaced = writeInboxArchiveUndo(
        [{ id: "a", callId: "ca" }, { id: "b", callId: "cb" }],
        now,
        store
      );
      const expired = readInboxArchiveUndo(now + INBOX_ARCHIVE_UNDO_MS, store);
      const empty = writeInboxArchiveUndo([{ id: " ", callId: "" }], now, store);
      const garbage = parseInboxArchiveUndo("{nope", now);
      writeInboxArchiveUndo([{ id: "keep", callId: "call" }], now, store);
      clearInboxArchiveUndo(store);
      console.log(JSON.stringify({
        ms: INBOX_ARCHIVE_UNDO_MS,
        key: INBOX_ARCHIVE_UNDO_KEY,
        label1: inboxArchiveUndoLabel(1),
        label2: inboxArchiveUndoLabel(3),
        written,
        fresh,
        replaced,
        expired,
        empty,
        garbage,
        afterClear: store.data.get(INBOX_ARCHIVE_UNDO_KEY) ?? null,
      }));
    `;
    const { spawnSync } = require("node:child_process");
    const ran = spawnSync(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", script], {
      encoding: "utf8",
    });
    assert.equal(ran.status, 0, ran.stderr || ran.stdout);
    return JSON.parse(ran.stdout.trim().split("\n").at(-1));
  }

  it("stores a 5s payload, replaces the last Archive, and drops expired rows", () => {
    const out = load();
    assert.equal(out.ms, 5000);
    assert.equal(out.key, "scalers-inbox-archive-undo");
    assert.equal(out.label1, "Archived");
    assert.equal(out.label2, "3 archived");
    assert.equal(out.written.rows[0].callId, "call-1");
    assert.equal(out.written.expiresAt, 1_000_000 + 5000);
    assert.equal(out.fresh.rows[0].id, "row-1");
    assert.equal(out.replaced.rows.length, 2);
    assert.equal(out.expired, null);
    assert.equal(out.empty, null);
    assert.equal(out.garbage, null);
    assert.equal(out.afterClear, null);
  });
});
