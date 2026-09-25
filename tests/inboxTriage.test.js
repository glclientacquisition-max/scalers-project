const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

function read(rel) {
  return fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
}

function compareInboxRecency(a, b) {
  if (a.createdAt < b.createdAt) return 1;
  if (a.createdAt > b.createdAt) return -1;
  return 0;
}

function compareInboxPin(a, b) {
  const ap = a.pinnedAt || "";
  const bp = b.pinnedAt || "";
  if (ap && !bp) return -1;
  if (!ap && bp) return 1;
  if (ap && bp && ap !== bp) return ap < bp ? 1 : -1;
  return 0;
}

function orderInboxItems(items, filter) {
  const rows = [...items];
  if (filter === "all" || filter === "answered") {
    rows.sort(compareInboxRecency);
  }
  rows.sort(compareInboxPin);
  return rows;
}

function itemIsSnoozed(item, now) {
  if (!item.snoozedUntil) return false;
  const until = Date.parse(item.snoozedUntil);
  return Number.isFinite(until) && until > now;
}

describe("inbox overflow persistence", () => {
  const overflow = read("dashboard/src/components/InboxRowOverflow.tsx");
  const select = read("dashboard/src/components/InboxRowSelect.tsx");
  const actions = read("dashboard/src/lib/inboxLeadActions.ts");
  const writers = read("dashboard/src/app/(desk)/calls/inboxTriageActions.ts");
  const purpose = read("dashboard/src/lib/inboxPurpose.ts");
  const triage = read("dashboard/src/lib/inboxTriage.ts");
  const sql = read("docs/supabase/inbox_triage.sql");
  const avatar = read("dashboard/src/components/InboxRowAvatar.tsx");
  const ui = read("dashboard/src/components/InboxRowUi.tsx");

  it("writes overflow verbs instead of patching local unread/mute/pin state", () => {
    assert.match(writers, /export async function inboxToggleRead/);
    assert.match(writers, /export async function inboxSnooze/);
    assert.match(actions, /inboxToggleMute/);
    assert.match(actions, /inboxTogglePin/);
    assert.match(actions, /inboxAssign/);
    assert.match(actions, /inboxAddLabel/);
    assert.doesNotMatch(actions, /export async function inboxToggleRead/);
    assert.doesNotMatch(actions, /export async function inboxSnooze/);
    assert.match(actions, /return inboxArchive\(item\)/);
    assert.match(overflow, /inboxTogglePin\(view\)/);
    assert.doesNotMatch(overflow, /inboxSnooze\(item\)/);
    assert.match(overflow, /inboxUnarchive\(item\)/);
    assert.doesNotMatch(overflow, /inboxToggleMute/);
    assert.doesNotMatch(overflow, /inboxAssign/);
    assert.doesNotMatch(overflow, /inboxAddLabel/);
    assert.doesNotMatch(overflow, /inboxDelete/);
    assert.doesNotMatch(overflow, /inboxToggleRead/);
    assert.doesNotMatch(overflow, /patch\(\{ unread:/);
    assert.doesNotMatch(overflow, /patch\(\{ muted:/);
    assert.doesNotMatch(overflow, /patch\(\{ pinned:/);
    assert.doesNotMatch(ui, /unread: boolean/);
  });

  it("archives Delete through the existing lead_status path", () => {
    assert.match(actions, /updateLeadStatus\(item\.callId, "archived"\)/);
    assert.match(actions, /return inboxArchive\(item\)/);
    assert.doesNotMatch(select, /inboxDelete/);
    assert.doesNotMatch(overflow, /inboxDelete/);
    assert.match(sql, /No owner DELETE on calls/);
    assert.doesNotMatch(sql, /delete from public.calls/i);
  });

  it("adds per-ticket fields that are not needsYou", () => {
    assert.match(sql, /inbox_read_at/);
    assert.match(sql, /inbox_muted/);
    assert.match(sql, /inbox_pinned_at/);
    assert.match(sql, /inbox_assignee/);
    assert.match(sql, /inbox_labels/);
    assert.match(sql, /inbox_snoozed_until/);
    assert.match(sql, /Distinct from needsYou/);
    assert.match(sql, /team_directory teammate label/);
    assert.match(purpose, /export function itemIsSnoozed/);
    assert.match(purpose, /export function compareInboxPin/);
    assert.match(triage, /inboxTeammateOptions/);
    assert.match(triage, /requireName: true/);
  });

  it("opens or creates a contact from phone, and keeps a stub without one", () => {
    assert.match(avatar, /ensureInboxContact/);
    assert.match(avatar, /contactFromInboxHref/);
    assert.match(avatar, /No history yet/);
    assert.match(avatar, /No phone/);
    assert.match(read("dashboard/src/app/(desk)/contacts/actions.ts"), /export async function ensureInboxContact/);
  });

  it("pins the current pile and returns snoozed rows when due", () => {
    const older = { createdAt: "2026-09-16T08:00:00.000Z", pinnedAt: null };
    const newer = { createdAt: "2026-09-17T08:00:00.000Z", pinnedAt: null };
    const pinned = { createdAt: "2026-09-15T08:00:00.000Z", pinnedAt: "2026-09-18T08:00:00.000Z" };
    const rows = orderInboxItems([newer, pinned, older], "all");
    assert.equal(rows[0], pinned);
    assert.equal(rows[1], newer);
    assert.equal(rows[2], older);
    const now = Date.parse("2026-09-18T12:00:00.000Z");
    assert.equal(itemIsSnoozed({ snoozedUntil: "2026-09-18T18:00:00.000Z" }, now), true);
    assert.equal(itemIsSnoozed({ snoozedUntil: "2026-09-18T10:00:00.000Z" }, now), false);
  });
});
