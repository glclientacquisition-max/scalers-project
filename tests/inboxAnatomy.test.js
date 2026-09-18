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
    assert.match(calls, /Visit layout uses FilterTabs/);
    assert.match(calls, /That row is the only layout switcher/);
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

  it("uses FilterTabs for List Today Week, never a filled selected layout", () => {
    const today = read("dashboard/src/components/RunSheetToday.tsx");
    const week = read("dashboard/src/components/VisitWeekCalendar.tsx");
    const page = read("dashboard/src/app/(desk)/calls/page.tsx");
    assert.match(toolbar, /label="Visit layout"/);
    assert.match(toolbar, /<FilterTabs/);
    assert.match(toolbar, /label: "Today"/);
    assert.match(toolbar, /label: "Week"/);
    assert.doesNotMatch(toolbar, /btnPrimary/);
    assert.doesNotMatch(today, /weekHref/);
    assert.doesNotMatch(today, />\s*Week\s*</);
    assert.doesNotMatch(week, />\s*List\s*</);
    assert.doesNotMatch(page, /weekHref=/);
    assert.match(today, /todayEmpty/);
    assert.match(today, />\s*List\s*</);
    const todayPhone = today.slice(today.indexOf("<ul className=\"mt-4"), today.indexOf("hidden md:block"));
    assert.match(todayPhone, /callerName \|\| "Caller"/);
    assert.match(todayPhone, /formatSlotClock/);
    assert.doesNotMatch(todayPhone, /placeFor/);
  });

  it("defines the call as decide and reply, not operator telemetry", () => {
    assert.match(callDetail, /Stack only below `lg`/);
    assert.match(callDetail, /that `h1` is the contact link/);
    assert.match(callDetail, /Confirm or Done full width/);
    assert.match(callDetail, /Reopen lives here/);
    assert.match(callDetail, /Could not save\./);
    assert.doesNotMatch(detail, />\s*Open contact\s*</);
    assert.match(detail, /No conversation\./);
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
    assert.match(markup, /order-1 min-w-0 lg:order-none/);
    assert.match(markup, /order-2 min-w-0 rounded-2xl border p-5 lg:order-none/);
    assert.match(markup, /order-3 min-w-0 space-y-5 lg:order-none/);
    assert.match(markup, /order-4 min-h-0 min-w-0 space-y-8 lg:order-none/);
    assert.match(markup, /order-5 min-w-0 space-y-4[\s\S]*Duration:/);
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
});
