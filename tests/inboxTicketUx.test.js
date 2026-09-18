const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

function read(rel) {
  return fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
}

describe("inbox ticket action chrome", () => {
  const detail = read("dashboard/src/app/(desk)/calls/[id]/page.tsx");
  const markup = detail.slice(detail.indexOf("return ("));
  const composer = read("dashboard/src/components/CallerNoteComposer.tsx");
  const mark = read("dashboard/src/components/MarkLeadDoneButton.tsx");
  const summary = read("dashboard/src/components/CallSummaryCard.tsx");

  it("centers the action group and captions Do next above the filled verb", () => {
    assert.match(markup, /mx-auto flex w-full max-w-lg flex-col items-stretch gap-2/);
    assert.match(markup, />\s*Do next\s*</);
    assert.match(markup, /doNextLabel/);
  });

  it("collapses SMS compose until Send SMS is pressed", () => {
    assert.match(composer, /collapsed = false/);
    assert.match(composer, /Send SMS/);
    assert.match(composer, /Hide SMS/);
    assert.match(markup, /collapsed/);
    assert.doesNotMatch(markup, /variant="link"/);
  });

  it("renders Mark done and Archive as real buttons with icons", () => {
    assert.match(markup, /<MarkLeadDoneButton callId=\{row.id\} variant="button"/);
    assert.match(markup, /<MarkLeadArchiveButton callId=\{row.id\} variant="button"/);
    assert.match(mark, /variant\?: "default" \| "icon" \| "button"/);
    assert.match(mark, /btnGhost/);
  });

  it("keeps Want, Do next, and Mood as the summary lead", () => {
    const structured = summary.slice(summary.indexOf("return ("));
    assert.ok(structured.indexOf('label="Want"') < structured.indexOf('label="Do next"'));
    assert.ok(structured.indexOf('label="Do next"') < structured.indexOf('label="Mood"'));
  });

  it("uses ghost WhatsApp when it is not the current task", () => {
    assert.match(markup, /variant="ghost"/);
    assert.match(markup, /label="Reply on WhatsApp"/);
  });
});

describe("inbox ticket transcript preview", () => {
  it("previews the last turns and expands the full thread on demand", () => {
    const src = read("dashboard/src/components/CallTranscript.tsx");
    const detail = read("dashboard/src/app/(desk)/calls/[id]/page.tsx");
    assert.match(detail, /<CallTranscript turns=\{turns\} \/>/);
    assert.match(src, /PREVIEW_TURNS = 3/);
    assert.match(src, /View full conversation/);
    assert.match(src, /Hide conversation/);
    assert.match(src, /No conversation\./);
    assert.match(src, /from-surface to-transparent/);
    assert.doesNotMatch(src, /[\u2014\u2013]/);
  });
});
