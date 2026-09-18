const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("fs");
const path = require("path");

function read(rel) {
  return fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
}

function loadTriage() {
  const purposePath = path.join(__dirname, "../dashboard/src/lib/inboxPurpose.ts");
  const triagePath = path.join(__dirname, "../dashboard/src/lib/inboxTriage.ts");
  const script = `
    import { itemIsSnoozed, orderInboxItems } from ${JSON.stringify(purposePath)};
    import { inboxTeammateOptions, inboxSnoozeUntilIso, INBOX_SNOOZE_MS } from ${JSON.stringify(triagePath)};
    const older = { createdAt: "2026-09-16T08:00:00.000Z", pinnedAt: null };
    const newer = { createdAt: "2026-09-17T08:00:00.000Z", pinnedAt: null };
    const pinned = { createdAt: "2026-09-15T08:00:00.000Z", pinnedAt: "2026-09-18T08:00:00.000Z" };
    const now = Date.parse("2026-09-18T12:00:00.000Z");
    const cases = {
      pinFirst: orderInboxItems([newer, pinned, older], "all").map((row) => row.createdAt),
      snoozed: itemIsSnoozed({ snoozedUntil: "2026-09-18T18:00:00.000Z" }, now),
      due: itemIsSnoozed({ snoozedUntil: "2026-09-18T10:00:00.000Z" }, now),
      emptyTeam: inboxTeammateOptions([]).length,
      namedTeam: inboxTeammateOptions([{ name: "Amina", role: "Owner", phone: "+254700000001" }]),
      skipBlank: inboxTeammateOptions([{ name: "  ", role: "", phone: "" }]).length,
      snoozeMs: INBOX_SNOOZE_MS,
      until: inboxSnoozeUntilIso(now),
    };
    console.log(JSON.stringify(cases));
  `;
  const ran = spawnSync(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", script], {
    encoding: "utf8",
  });
  assert.equal(ran.status, 0, ran.stderr || ran.stdout);
  return JSON.parse(ran.stdout.trim().split("\n").at(-1));
}

describe("inbox overflow persistence", () => {
  const overflow = read("dashboard/src/components/InboxRowOverflow.tsx");
  const select = read("dashboard/src/components/InboxRowSelect.tsx");
  const actions = read("dashboard/src/lib/inboxLeadActions.ts");
  const sql = read("docs/supabase/inbox_triage.sql");
  const avatar = read("dashboard/src/components/InboxRowAvatar.tsx");
  const ui = read("dashboard/src/components/InboxRowUi.tsx");

  it("writes overflow verbs instead of patching local unread/mute/pin state", () => {
    assert.match(actions, /inboxToggleRead/);
    assert.match(actions, /inboxToggleMute/);
    assert.match(actions, /inboxTogglePin/);
    assert.match(actions, /inboxAssign/);
    assert.match(actions, /inboxAddLabel/);
    assert.match(actions, /inboxSnooze/);
    assert.match(actions, /inboxDelete\(item: InboxItem\) \{\n  return inboxArchive\(item\);/);
    assert.match(overflow, /inboxToggleRead\(item\)/);
    assert.match(overflow, /inboxToggleMute\(item\)/);
    assert.match(overflow, /inboxTogglePin\(item\)/);
    assert.match(overflow, /inboxSnooze\(item\)/);
    assert.match(overflow, /inboxDelete\(item\)/);
    assert.match(overflow, /inboxAssign\(item, value\)/);
    assert.match(overflow, /inboxAddLabel\(item, value\)/);
    assert.doesNotMatch(overflow, /patch\(\{ unread:/);
    assert.doesNotMatch(overflow, /patch\(\{ muted:/);
    assert.doesNotMatch(overflow, /patch\(\{ pinned:/);
    assert.doesNotMatch(ui, /unread: boolean/);
  });

  it("archives Delete through the existing lead_status path", () => {
    assert.match(actions, /updateLeadStatus\(item\.callId as string, "archived"\)/);
    assert.match(select, /inboxDelete\(item\)/);
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
  });

  it("opens or creates a contact from phone, and keeps a stub without one", () => {
    assert.match(avatar, /ensureInboxContact/);
    assert.match(avatar, /contactFromInboxHref/);
    assert.match(avatar, /No history yet/);
    assert.match(avatar, /No phone/);
    assert.match(read("dashboard/src/app/(desk)/contacts/actions.ts"), /export async function ensureInboxContact/);
  });

  it("pins the current pile and returns snoozed rows when due", () => {
    const cases = loadTriage();
    assert.deepEqual(cases.pinFirst, [
      "2026-09-15T08:00:00.000Z",
      "2026-09-17T08:00:00.000Z",
      "2026-09-16T08:00:00.000Z",
    ]);
    assert.equal(cases.snoozed, true);
    assert.equal(cases.due, false);
    assert.equal(cases.emptyTeam, 0);
    assert.equal(cases.skipBlank, 0);
    assert.equal(cases.namedTeam[0].label, "Amina");
    assert.equal(cases.snoozeMs, 24 * 60 * 60 * 1000);
    assert.equal(cases.until, new Date(Date.parse("2026-09-18T12:00:00.000Z") + cases.snoozeMs).toISOString());
  });
});
