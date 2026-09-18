const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

function read(rel) {
  return fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
}

describe("inbox outside and inside anatomy", () => {
  const row = read("dashboard/src/components/InboxItemRow.tsx");
  const toolbar = read("dashboard/src/components/InboxToolbar.tsx");
  const detail = read("dashboard/src/app/(desk)/calls/[id]/page.tsx");
  const jobActions = read("dashboard/src/components/InboxJobActions.tsx");
  const holdActions = read("dashboard/src/components/RequestStatusToggle.tsx");
  const calls = read("docs/frontend/design-system/pages/calls.md");
  const callDetail = read("docs/frontend/design-system/pages/call-detail.md");

  it("defines list as who, one preview, stamp or time, one dock verb", () => {
    assert.match(calls, /Who first\. Work second\. Stamp or time as meta/);
    assert.match(calls, /Do not stack a second detail line under Work on mixed filters/);
    assert.match(calls, /Hold sort/);
    assert.match(calls, /Anytime stays on List/);
    assert.match(calls, /Reopen lives on the call, never beside Done on the list/);
    assert.match(row, /function InboxPhoneRow/);
    const phone = row.slice(row.indexOf("export function InboxPhoneRow"));
    assert.doesNotMatch(phone, /InboxPurposeChip/);
    assert.doesNotMatch(phone, /\{place\}/);
    assert.match(row, /deskPreviewClass/);
  });

  it("keeps isolated hold and visit table cells to one preview line", () => {
    const holdBlock = row.slice(row.indexOf('{kind === "hold"'), row.indexOf('{kind === "job"'));
    assert.doesNotMatch(holdBlock, /holdTypeLabel/);
    const jobBlock = row.slice(row.indexOf('{kind === "job"'), row.indexOf('{kind === "mixed"'));
    assert.doesNotMatch(jobBlock, /item\.headline/);
  });

  it("uses FilterTabs for List and Work, with Today Week under Work", () => {
    const today = read("dashboard/src/components/RunSheetToday.tsx");
    const week = read("dashboard/src/components/VisitWeekCalendar.tsx");
    const page = read("dashboard/src/components/InboxWorkspace.tsx");
    assert.match(toolbar, /label="Visit sort"/);
    assert.match(toolbar, /label="Work date"/);
    assert.match(toolbar, /label: "Work"/);
    assert.match(toolbar, /label: "Today"/);
    assert.match(toolbar, /label: "Week"/);
    assert.doesNotMatch(toolbar, /btnPrimary/);
    assert.match(page, /RunSheetToday/);
    assert.match(page, /VisitWeekCalendar/);
    assert.match(today, /dayHeading/);
    assert.match(today, /formatSlotClock/);
    assert.match(today, /todayEmpty/);
    assert.match(week, /weekHeading/);
    assert.match(week, /md:grid md:grid-cols-7/);
    assert.match(week, /md:hidden/);
    assert.match(week, /filledDays/);
    assert.doesNotMatch(today, /weekHref/);
    assert.doesNotMatch(page, /weekHref=/);
    const todayPhone = today.slice(today.indexOf("<ul className=\"mt-4"), today.indexOf("hidden md:block"));
    assert.match(todayPhone, /callerName \|\| "Caller"/);
    assert.match(todayPhone, /clockFor/);
    assert.doesNotMatch(todayPhone, /placeFor/);
  });

  it("uses FilterTabs for Holds List and Work, Today only", () => {
    const page = read("dashboard/src/components/InboxWorkspace.tsx");
    const today = read("dashboard/src/components/RunSheetToday.tsx");
    const sheet = read("dashboard/src/lib/holdSheet.ts");
    assert.match(toolbar, /label="Hold sort"/);
    assert.match(page, /holdBoardForDay/);
    assert.match(page, /purpose="hold"/);
    assert.match(today, /RequestStatusToggle/);
    assert.match(today, /formatHoldClock/);
    assert.match(sheet, /=== "open"/);
    assert.doesNotMatch(sheet, /VisitWeekCalendar/);
    const holdBlock = toolbar.slice(toolbar.indexOf('label="Hold sort"'), toolbar.indexOf('label="Work date"'));
    assert.match(holdBlock, /label: "Work"/);
    assert.doesNotMatch(holdBlock, /label: "Week"/);
  });

  it("defines the call as decide and reply, not operator telemetry", () => {
    assert.match(callDetail, /The call pane stacks/);
    assert.match(callDetail, /that `h1` is the contact link/);
    assert.match(callDetail, /Confirm or Done full width/);
    assert.match(callDetail, /Reopen lives here/);
    assert.match(callDetail, /Could not save\./);
    assert.doesNotMatch(detail, />\s*Open contact\s*</);
    assert.match(read("dashboard/src/components/CallTranscript.tsx"), /No conversation\./);
    assert.doesNotMatch(detail, / · \{row\.primary_intent\}/);
    assert.doesNotMatch(detail, /Alert sent:/);
    assert.doesNotMatch(detail, /No transcript rows for this call/);
    const markup = detail.slice(detail.indexOf("return ("));
    const summaryAt = markup.indexOf("Summary");
    const actionsAt = Math.min(
      ...["<InboxJobActions", "<RequestStatusToggle", "<CallerNoteComposer"]
        .map((token) => markup.indexOf(token))
        .filter((i) => i >= 0)
    );
    assert.ok(summaryAt >= 0 && summaryAt < actionsAt, "Summary sits before Actions");
    const transcriptAt = markup.indexOf("<CallTranscript");
    const durationAt = markup.indexOf("Duration:");
    assert.ok(actionsAt < transcriptAt, "Conversation sits after Actions");
    assert.ok(transcriptAt < durationAt, "Facts sit after Conversation");
    assert.doesNotMatch(markup, /display: contents|className="contents /);
    assert.doesNotMatch(detail, /InboxWorkspace/);
  });

  it("makes Confirm and Done full width on the call, dock-sized on the list", () => {
    const editorJob = read("dashboard/src/components/InboxJobEditor.tsx");
    const editorHold = read("dashboard/src/components/InboxHoldEditor.tsx");
    const back = read("dashboard/src/components/ui/DeskBack.tsx");
    const contact = read("dashboard/src/app/(desk)/contacts/[id]/page.tsx");
    assert.match(jobActions, /extra \? `\$\{btnPrimary\} w-full` : btnDock/);
    assert.match(holdActions, /extra \? `\$\{btnPrimary\} w-full` : btnDock/);
    const fulfilled = holdActions.slice(
      holdActions.indexOf('{normalized === "fulfilled"'),
      holdActions.indexOf('{normalized === "cancelled"')
    );
    assert.match(fulfilled, /\{extra \? \(/);
    assert.match(fulfilled, /Reopen/);
    assert.match(editorJob, /Could not save\./);
    assert.match(editorHold, /Could not save\./);
    assert.doesNotMatch(editorJob, /\{state\.error\}/);
    assert.doesNotMatch(editorHold, /\{state\.error\}/);
    assert.doesNotMatch(editorJob, /InboxJobActions/);
    assert.doesNotMatch(editorHold, /RequestStatusToggle/);
    assert.match(detail, /inboxRecordHref|inboxReturnHref/);
    assert.match(detail, /<DeskBack/);
    assert.match(detail, /InboxJobActions/);
    assert.match(back, /min-h-11/);
    assert.match(contact, /<DeskBack/);
    assert.match(jobActions, /pendingSpinnerClass/);
    assert.match(holdActions, /pendingSpinnerClass/);
  });

  it("opens the call beside Inbox on md and closes with Esc", () => {
    const workspace = read("dashboard/src/components/InboxWorkspace.tsx");
    const layout = read("dashboard/src/app/(desk)/calls/layout.tsx");
    const slot = read("dashboard/src/app/(desk)/calls/@inbox/[id]/page.tsx");
    const listSlot = read("dashboard/src/app/(desk)/calls/@inbox/page.tsx");
    const callsPage = read("dashboard/src/app/(desk)/calls/page.tsx");
    const esc = read("dashboard/src/components/InboxEscClose.tsx");
    assert.match(layout, /inbox: React.ReactNode/);
    assert.match(layout, /InboxSplit/);
    assert.match(layout, /list=\{inbox\}/);
    const split = read("dashboard/src/components/InboxSplit.tsx");
    assert.match(split, /role="separator"/);
    assert.match(split, /aria-label="Inbox list width"/);
    assert.match(split, /ArrowLeft/);
    assert.match(split, /INBOX_SPLIT_KEY/);
    assert.match(split, /data-desk-bleed/);
    const column = read("dashboard/src/components/InboxColumn.tsx");
    assert.match(column, /md:w-\[20rem\]/);
    assert.match(column, /lg:w-\[24rem\]/);
    assert.match(column, /xl:w-\[28rem\]/);
    assert.match(column, /--inbox-list-w/);
    assert.match(column, /md:overflow-x-hidden md:overflow-y-auto/);
    assert.match(slot, /<InboxWorkspace/);
    assert.match(slot, /pane/);
    assert.match(slot, /openCallId=\{id\}/);
    assert.match(listSlot, /pane/);
    assert.match(callsPage, /return null/);
    assert.doesNotMatch(detail, /InboxWorkspace/);
    assert.match(detail, /<InboxEscClose href=\{backHref\} \/>/);
    assert.match(detail, /aria-label="Close call"/);
    assert.match(detail, />\s*Close\s*</);
    assert.match(detail, /md:hidden/);
    assert.match(esc, /event.key !== "Escape"/);
    assert.match(esc, /role='dialog'/);
    assert.match(workspace, /pane\?: boolean/);
    assert.match(workspace, /const split = Boolean\(pane\)/);
    assert.match(workspace, /current=\{rowIsOpen\(item, openCallId\)\}/);
    assert.match(workspace, /overflow-x-hidden overflow-y-auto/);
    assert.doesNotMatch(workspace, /DeskDataTable/);
    assert.doesNotMatch(workspace, /InboxTableRow/);
    assert.match(column, /hidden min-w-0 md:flex/);
    assert.match(column, /hidden min-w-0 flex-1 md:block/);
    const harness = read("dashboard/src/app/dev/inbox/page.tsx");
    assert.match(harness, /InboxSplit/);
    assert.doesNotMatch(harness, /DeskDataTable/);
    assert.match(row, /current\?: boolean/);
    assert.match(callDetail, /Esc and Close return to Inbox/);
    assert.match(callDetail, /parallel `@inbox` slot/);
  });
});
