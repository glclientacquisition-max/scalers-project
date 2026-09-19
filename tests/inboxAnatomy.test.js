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
    const page = read("dashboard/src/app/(desk)/calls/page.tsx");
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
    const page = read("dashboard/src/app/(desk)/calls/page.tsx");
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
    assert.match(callDetail, /From `lg`, summary left and transcript right/);
    assert.match(callDetail, /The stamp is read-only/);
    assert.match(callDetail, /sendInboxReplySms/);
    assert.doesNotMatch(detail, />\s*Open contact\s*</);
    assert.match(read("dashboard/src/components/CallTranscript.tsx"), /No conversation\./);
    assert.doesNotMatch(detail, / · \{row\.primary_intent\}/);
    assert.doesNotMatch(detail, /Alert sent:/);
    assert.doesNotMatch(detail, /No transcript rows for this call/);
    assert.match(detail, /<InboxTicketView/);
    assert.doesNotMatch(detail, /LeadStatusToggle/);
    const ticket = read("dashboard/src/components/InboxTicketView.tsx");
    assert.match(ticket, /<DeskBack/);
    assert.match(ticket, /InboxJobActions/);
  });

  it("makes Confirm and Done full width on the call, dock-sized on the list", () => {
    const editorJob = read("dashboard/src/components/InboxJobEditor.tsx");
    const editorHold = read("dashboard/src/components/InboxHoldEditor.tsx");
    const back = read("dashboard/src/components/ui/DeskBack.tsx");
    const contact = read("dashboard/src/app/(desk)/contacts/[id]/page.tsx");
    assert.match(jobActions, /wide \? `\$\{btnPrimary\} w-full` : btnDock/);
    assert.match(holdActions, /wide \? `\$\{btnPrimary\} w-full` : btnDock/);
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
    const ticket = read("dashboard/src/components/InboxTicketView.tsx");
    assert.match(ticket, /<DeskBack/);
    assert.match(ticket, /InboxJobActions/);
    assert.match(back, /min-h-11/);
    assert.match(contact, /<DeskBack/);
    assert.match(jobActions, /pendingSpinnerClass/);
    assert.match(holdActions, /pendingSpinnerClass/);
  });

  it("texts the caller on hold Done and Cancel when Text customers is on", () => {
    const actions = read("dashboard/src/app/(desk)/requests/actions.ts");
    const statusFn = actions.slice(
      actions.indexOf("export async function updateServiceRequestStatus"),
      actions.indexOf("export async function updateServiceRequestSchedule")
    );
    assert.match(statusFn, /prefs\.caller_sms/);
    assert.match(statusFn, /caller_hold_ready/);
    assert.match(statusFn, /caller_hold_cancelled/);
    assert.match(statusFn, /type === "hold" \|\| type === "order"/);
    assert.match(statusFn, /sendRecordedDeskCallerSms/);
    const contract = read("docs/CALL_MESSAGE_CONTRACT.md");
    assert.match(contract, /caller_hold_ready/);
    assert.match(contract, /caller_hold_cancelled/);
    assert.match(contract, /Owner taps Done/);
  });
});
