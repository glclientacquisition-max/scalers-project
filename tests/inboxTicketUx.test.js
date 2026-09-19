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
    assert.match(ticket, /dockedAction/);
    assert.match(ticket, /border border-line bg-surface text-ink/);
    assert.match(ticket, /sr-only">Jump to latest/);
    assert.match(ticket, /InboxSmsDock/);
    assert.match(ticket, /needsYou && !archived \? \(/);
    assert.doesNotMatch(detail, /LeadStatusToggle/);
    assert.doesNotMatch(ticket, /LeadStatusToggle/);
    assert.doesNotMatch(detail, /MarkLeadDoneButton/);
    assert.doesNotMatch(detail, /MarkLeadUnarchiveButton/);
  });

  it("splits summary left and transcript right from lg", () => {
    const splitAt = ticket.indexOf("data-ticket-split");
    const summaryAt = ticket.indexOf("data-ticket-summary");
    const threadAt = ticket.indexOf("data-ticket-thread");
    const transcriptAt = ticket.indexOf("<CallTranscript turns={turns} mode=\"thread\" />");
    const dockAt = ticket.indexOf("<InboxSmsDock");
    assert.ok(splitAt > 0 && summaryAt > splitAt && threadAt > summaryAt);
    assert.ok(transcriptAt > threadAt);
    assert.ok(dockAt > threadAt);
    assert.match(ticket, /lg:grid lg:grid-cols-\[minmax\(18rem,22rem\)_minmax\(0,1fr\)\]/);
    assert.match(ticket, /lg:contents/);
    assert.match(ticket, /<TicketSummaryFacts want=\{want\} mood=\{mood\} done=\{done\} \/>/);
    assert.match(ticket, />Want</);
    assert.match(ticket, />Mood</);
    assert.match(ticket, />Done</);
    assert.doesNotMatch(ticket, /Want\. \$\{want\}/);
    const summaryBlock = ticket.slice(summaryAt, threadAt);
    const threadBlock = ticket.slice(threadAt, dockAt);
    assert.match(summaryBlock, /InboxJobEditor/);
    assert.match(summaryBlock, /InboxHoldEditor/);
    assert.match(summaryBlock, /CallRecording/);
    assert.match(threadBlock, /CallTranscript/);
    assert.match(threadBlock, /CallFaqSuggestions/);
    assert.doesNotMatch(threadBlock, /InboxJobEditor/);
    assert.doesNotMatch(threadBlock, /CallRecording/);
    assert.match(ticket, /InboxSmsDock callId=\{callId\} callerPhone=\{callerPhone\}/);
  });

  it("keeps the purpose stamp read-only and archives from More", () => {
    assert.match(ticket, /InboxPurposeChip/);
    assert.match(ticket, /aria-label="More"/);
    assert.match(detail, /inboxReturnHref\(inboxReturn\)/);
    assert.match(ticket, /InboxTicketMore callId=\{callId\} backHref=\{backHref\}/);
    assert.match(ticket, /updateLeadStatus\(callId, "archived"\)/);
    assert.match(ticket, /router\.push\(backHref\)/);
    assert.doesNotMatch(ticket, /router\.push\("\/calls"\)/);
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
    assert.match(dock, /aria-label="Send"/);
    assert.match(dock, /title="Send"/);
    assert.match(dock, /SendGlyph/);
    assert.match(dock, /min-h-11 min-w-11/);
    assert.match(dock, /btnPrimaryFill/);
    assert.doesNotMatch(dock, /\{sendPending \? "Sending" : "Send"\}/);
  });

  it("puts a muted polish wand beside SMS compose", () => {
    const wandAt = dock.indexOf('aria-label="Polish"');
    const sendAt = dock.indexOf('aria-label="Send"');
    assert.ok(wandAt > 0, "wand control missing");
    assert.ok(sendAt > wandAt, "wand must sit beside Send, not after it");
    assert.match(dock, /title="Polish"/);
    assert.match(dock, /polishInboxSmsAction/);
    assert.match(dock, /deskHitClass/);
    assert.match(dock, /pendingSpinnerInkClass/);
    assert.match(dock, /type="button"/);
    const wandBtnStart = dock.lastIndexOf("<button", wandAt);
    const wandBtnEnd = dock.indexOf("</button>", wandAt);
    const wandBlock = dock.slice(wandBtnStart, wandBtnEnd);
    assert.doesNotMatch(wandBlock, /btnPrimary/);
    assert.doesNotMatch(wandBlock, /bg-accent-fill/);
    assert.match(dock, /disabled=\{polishPending \|\| sendPending \|\| !note\.trim\(\)\}/);
    assert.match(dock, /disabled=\{sendPending \|\| !canSend\}/);
    assert.doesNotMatch(dock, /disabled=\{sendPending \|\| polishPending/);
    assert.doesNotMatch(dock, /[\u2014\u2013]/);
  });

  it("hides the wand when the SMS bar is hidden", () => {
    assert.match(ticket, /needsYou && !archived \? \(/);
    assert.match(ticket, /InboxSmsDock callId=\{callId\} callerPhone=\{callerPhone\}/);
    assert.match(dock, /callerPhone \? \(/);
    const row = read("dashboard/src/components/InboxItemRow.tsx");
    assert.doesNotMatch(row, /aria-label="Polish"/);
    assert.doesNotMatch(row, /polishInboxSmsAction/);
    assert.doesNotMatch(ticket, /aria-label="Polish"/);
  });

  it("does not invent text for an empty draft", () => {
    assert.match(notes, /export async function polishInboxSmsAction/);
    const start = notes.indexOf("export async function polishInboxSmsAction");
    const end = notes.indexOf("export async function sendCallerNoteAction", start);
    const action = notes.slice(start, end > start ? end : undefined);
    assert.match(action, /if \(!note\) return \{ error: "Write a message\." \}/);
    assert.doesNotMatch(action, /The team will follow up/);
    assert.doesNotMatch(action, /fallbackPolishCallerNote/);
    assert.doesNotMatch(action, /Hi \$\{/);
    assert.match(dock, /!note\.trim\(\)/);
  });

  it("replaces the SMS textarea from the polish handler", () => {
    assert.match(dock, /if \(polishState\.text\) setNote\(polishState\.text\)/);
    assert.match(dock, /polishInboxSmsAction/);
    assert.match(notes, /fallbackPolishInboxDraft/);
    assert.match(notes, /POLISH_INBOX_DRAFT_SYSTEM/);
    assert.match(notes, /generateGeminiText/);
  });

  it("banners Confirm or hold Done only when a work row exists", () => {
    assert.match(ticket, /canConfirm/);
    assert.match(ticket, /canHoldDone/);
    assert.match(ticket, /InboxJobActions id=\{job.id\} status=\{job.status\} banner/);
    assert.match(ticket, /RequestStatusToggle id=\{hold.id\} status=\{hold.status\} banner/);
    assert.match(ticket, /<TicketSummaryFacts want=\{want\} mood=\{mood\} done=\{done\} \/>/);
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
