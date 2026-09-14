const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

function read(rel) {
  return fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
}

describe("home overview craft", () => {
  const page = read("dashboard/src/app/(desk)/home/page.tsx");
  const triage = read("dashboard/src/lib/callsTriage.ts");

  it("uses greeting eyebrow, business name, and Nairobi date", () => {
    assert.match(page, /nairobiGreeting\(\)/);
    assert.match(page, /nairobiDateLabel\(\)/);
    assert.match(page, /<time dateTime=\{today\.iso\}>/);
    assert.match(triage, /export function nairobiDateLabel/);
    assert.doesNotMatch(page, />Overview</);
  });

  it("maps Inbox queues and does not invent Online", () => {
    assert.match(page, /purpose: "human"/);
    assert.match(page, /purpose: "hold"/);
    assert.match(page, /purpose: "job"/);
    assert.match(page, /lineStatusLabel\(line\)/);
    assert.match(page, />\s*Work\s*</);
    assert.match(page, /homeBriefing/);
    assert.doesNotMatch(page, /DeskDataTable/);
    assert.doesNotMatch(page, /TriageLeadCard/);
    assert.doesNotMatch(page, /\bOnline\b/);
  });

  it("earns desktop width with a Next to return column", () => {
    assert.match(page, /nextReturn/);
    assert.match(page, /Next to return/);
    assert.match(page, /Reply on WhatsApp/);
    assert.match(page, /Open call/);
    assert.match(page, /lg:col-span-7/);
    assert.match(page, /lg:col-span-5/);
  });

  it("splits the aside into Today, Line, and Wallet sections", () => {
    assert.match(page, /aria-label="Today"/);
    assert.match(page, /aria-label="Line"/);
    assert.match(page, /aria-label="Wallet"/);
    assert.match(page, /Top up/);
    assert.match(page, /KES \{kes\.toLocaleString/);
  });

  it("keeps one blue action and earns the card on desktop only", () => {
    assert.match(page, /variant="ghost"/);
    assert.doesNotMatch(page, /variant="primary"/);
    assert.match(page, /hidden rounded-2xl border border-line bg-surface p-4 lg:block/);
    assert.match(page, /nextReturn\.callerPhone \|\| nextReturn\.callId/);
  });

  it("gives queue counts visual weight", () => {
    assert.match(page, /tabular-nums text-base font-semibold text-ink/);
  });

  it("formats the DID with spaces", () => {
    assert.match(page, /didDisplay/);
    assert.match(page, /\+254 \$1 \$2 \$3/);
  });
});
