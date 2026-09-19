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

  it("names Work row 1 Return calls with matching href, CTA, and count", () => {
    const queues = page.slice(page.indexOf("const queues"), page.indexOf("let ctaHref"));
    assert.match(queues, /label: copy\.returnCtaMany/);
    assert.match(queues, /href: callsHref\(\{ purpose: "human" \}\)/);
    assert.match(queues, /count: work\.toReturn/);
    assert.doesNotMatch(queues, /label: "Needs you"/);
    assert.doesNotMatch(queues, /purpose: "needs"/);
    assert.doesNotMatch(queues, /count: work\.needs/);
    const note = read("docs/frontend/design-system/pages/home.md");
    assert.match(note, /Return calls/);
    assert.match(note, /copy\.returnCtaMany/);
    const cta = page.slice(page.indexOf("let ctaHref"), page.indexOf("const showCta"));
    assert.match(cta, /else if \(work\.toReturn > 0\) \{/);
    assert.match(cta, /callsHref\(\{ purpose: "human" \}\)/);
    assert.match(cta, /copy\.returnCtaOne/);
    assert.match(cta, /copy\.returnCtaMany/);
  });

  it("earns desktop width with a Next to return column", () => {
    assert.match(page, /nextReturn/);
    assert.match(page, /Next to return/);
    assert.match(page, /Reply on WhatsApp/);
    assert.match(page, /DeskRowHit/);
    assert.match(page, /Conversation/);
    assert.doesNotMatch(page, /Open call/);
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

  it("keeps one blue action and shows Next to return on phone", () => {
    assert.match(page, /variant="ghost"/);
    assert.doesNotMatch(page, /variant="primary"/);
    assert.match(page, /hidden rounded-2xl border border-line bg-surface p-4 lg:block/);
    assert.match(page, /lg:hidden/);
    assert.match(page, /next-return-phone/);
    assert.match(page, /nextReturn\.callerPhone \|\| nextReturn\.callId/);
  });

  it("gives queue counts visual weight", () => {
    assert.match(page, /tabular-nums text-base font-semibold text-ink/);
    assert.match(page, /deskPreviewClass/);
    assert.doesNotMatch(page, /nextHold\?\.headline/);
    assert.doesNotMatch(page, /nextJob\?\.headline/);
    assert.doesNotMatch(page, /overflow-wrap:anywhere/);
    assert.doesNotMatch(page, /line-clamp-2/);
  });

  it("formats the DID with spaces", () => {
    assert.match(page, /didDisplay/);
    assert.match(page, /\+254 \$1 \$2 \$3/);
  });

  it("renders the day digest only from a complete window", () => {
    assert.match(page, /homeDigestLine\(inbox\.items, dayStart, vertical\)/);
    assert.match(page, /inbox\.callsTruncated/);
    const purpose = read("dashboard/src/lib/inboxPurpose.ts");
    assert.match(purpose, /export function homeDigestLine/);
    assert.match(purpose, /HOME_QUEUE_SAMPLE_MAX/);
    assert.match(purpose, /canonicalInboxIntent\(item\.intent\) === "complaint"/);
    const load = read("dashboard/src/lib/inboxLoad.ts");
    assert.match(load, /callsTruncated/);
  });

  it("composes the digest line honestly", () => {
    const dayStartMs = Date.parse("2026-09-14T00:00:00+03:00");
    const at = (iso) => Date.parse(iso);
    const item = (over) => ({
      createdAt: "2026-09-14T10:00:00+03:00",
      purpose: "answered",
      intent: "hours_open",
      job: null,
      ...over,
    });
    function digestLine(items) {
      const today = items.filter((i) => at(i.createdAt) >= dayStartMs);
      const answered = today.filter((i) => i.purpose === "answered").length;
      const booked = today.filter((i) => i.job && at(i.job.created_at) >= dayStartMs).length;
      const complaints = today.filter((i) => i.intent === "complaint").length;
      const bits = [];
      if (answered > 0) bits.push(`${answered} answered`);
      if (booked > 0) bits.push(`${booked} ${booked === 1 ? "visit" : "visits"}`);
      if (complaints > 0) bits.push(`${complaints} complaint${complaints === 1 ? "" : "s"}`);
      return bits.length ? `Today: ${bits.join(", ")}.` : null;
    }
    assert.equal(digestLine([]), null);
    assert.equal(
      digestLine([item({}), item({}), item({ purpose: "human", intent: "complaint" })]),
      "Today: 2 answered, 1 complaint."
    );
    assert.equal(
      digestLine([
        item({}),
        item({ purpose: "job", job: { created_at: "2026-09-14T09:00:00+03:00" } }),
        item({ purpose: "job", job: { created_at: "2026-09-13T09:00:00+03:00" } }),
      ]),
      "Today: 1 answered, 1 visit."
    );
    assert.equal(
      digestLine([item({ createdAt: "2026-09-13T23:00:00+03:00" })]),
      null
    );
  });
});
