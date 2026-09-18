const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

function read(rel) {
  return fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
}

describe("inbox ticket action chrome", () => {
  const detail = read("dashboard/src/app/(desk)/calls/[id]/page.tsx");
  const ticket = read("dashboard/src/components/InboxTicketView.tsx");
  const dock = read("dashboard/src/components/InboxSmsDock.tsx");
  const notes = read("dashboard/src/app/(desk)/calls/noteActions.ts");
  const summary = read("dashboard/src/components/CallSummaryCard.tsx");

  it("uses a fixed header, scrolling thread, and docked SMS", () => {
    assert.match(detail, /<InboxTicketView/);
    assert.match(ticket, /DeskBack/);
    assert.match(ticket, /Jump to latest/);
    assert.match(ticket, /InboxSmsDock/);
    assert.match(ticket, /needsYou && !archived \? \(/);
    assert.doesNotMatch(detail, /LeadStatusToggle/);
    assert.doesNotMatch(ticket, /LeadStatusToggle/);
    assert.doesNotMatch(detail, /MarkLeadDoneButton/);
    assert.doesNotMatch(detail, /MarkLeadUnarchiveButton/);
  });

  it("keeps the purpose stamp read-only and archives from More", () => {
    assert.match(ticket, /InboxPurposeChip/);
    assert.match(ticket, /aria-label="More"/);
    assert.match(ticket, /updateLeadStatus\(callId, "archived"\)/);
    assert.match(ticket, /\{busy \? "Saving" : "Archive"\}/);
    assert.doesNotMatch(ticket, /Followed Up/);
  });

  it("docks a real SMS send distinct from Confirm auto-SMS", () => {
    assert.match(dock, /sendInboxReplySms/);
    assert.match(dock, /placeholder="SMS"/);
    assert.match(dock, /WhatsApp uses the icon above/);
    assert.match(dock, /rows=\{2\}/);
    assert.match(notes, /export async function sendInboxReplySms/);
    assert.match(notes, /caller_inbox_reply/);
    assert.match(notes, /sendRecordedDeskCallerSms/);
    assert.match(dock, /name="reply_id"/);
    assert.match(ticket, /tone="thread"/);
    assert.doesNotMatch(notes, /caller_appointment_confirmed/);
  });

  it("banners Confirm or hold Done only when a work row exists", () => {
    assert.match(ticket, /canConfirm/);
    assert.match(ticket, /canHoldDone/);
    assert.match(ticket, /InboxJobActions id=\{job.id\} status=\{job.status\} banner/);
    assert.match(ticket, /RequestStatusToggle id=\{hold.id\} status=\{hold.status\} banner/);
    assert.match(ticket, /Want\. \$\{want\}/);
  });

  it("keeps Want, Do next, and Mood as the summary lead", () => {
    const structured = summary.slice(summary.indexOf("return ("));
    assert.ok(structured.indexOf('label="Want"') < structured.indexOf('label="Do next"'));
    assert.ok(structured.indexOf('label="Do next"') < structured.indexOf('label="Mood"'));
  });
});

describe("inbox ticket transcript preview", () => {
  it("renders the full thread on the ticket and keeps preview elsewhere", () => {
    const src = read("dashboard/src/components/CallTranscript.tsx");
    const ticket = read("dashboard/src/components/InboxTicketView.tsx");
    assert.match(ticket, /<CallTranscript turns=\{turns\} mode="thread" \/>/);
    assert.match(src, /PREVIEW_TURNS = 3/);
    assert.match(src, /View full conversation/);
    assert.match(src, /Hide conversation/);
    assert.match(src, /No conversation\./);
    assert.match(src, /from-surface to-transparent/);
    assert.match(src, /mode === "thread"/);
    assert.doesNotMatch(src, /[\u2014\u2013]/);
  });
});
