const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

function read(rel) {
  return fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
}

const helperPath = path.join(__dirname, "../dashboard/src/lib/deskTicketChat.ts");

function loadHelper() {
  const script = `
    import { isDeskTicketChatPath, plainOwnerCopy } from ${JSON.stringify(helperPath)};
    console.log(JSON.stringify({
      list: isDeskTicketChatPath("/calls"),
      ticket: isDeskTicketChatPath("/calls/abc-123"),
      slash: isDeskTicketChatPath("/calls/abc-123/"),
      nested: isDeskTicketChatPath("/calls/abc-123/edit"),
      query: isDeskTicketChatPath("/calls/abc-123?from=needs"),
      contacts: isDeskTicketChatPath("/contacts/abc-123"),
      home: isDeskTicketChatPath("/home"),
      empty: isDeskTicketChatPath(""),
      nil: isDeskTicketChatPath(null),
      em: plainOwnerCopy("Very short call \\u2014 little conversation"),
      en: plainOwnerCopy("Needs human \\u2013 notify failed"),
      plain: plainOwnerCopy("Visit saved"),
      emptyCopy: plainOwnerCopy(""),
      nilCopy: plainOwnerCopy(null),
    }));
  `;
  const ran = spawnSync(
    process.execPath,
    ["--experimental-strip-types", "--input-type=module", "-e", script],
    { encoding: "utf8" }
  );
  assert.equal(ran.status, 0, ran.stderr || ran.stdout);
  return JSON.parse(ran.stdout.trim().split("\n").at(-1));
}

describe("ticket chat follow-ups", () => {
  const ticket = read("dashboard/src/components/InboxTicketView.tsx");
  const dock = read("dashboard/src/components/InboxSmsDock.tsx");
  const nav = read("dashboard/src/components/DeskNav.tsx");
  const css = read("dashboard/src/app/globals.css");
  const transcript = read("dashboard/src/components/CallTranscript.tsx");
  const helper = read("dashboard/src/lib/deskTicketChat.ts");
  const action = read("dashboard/src/components/InboxTicketActionDock.tsx");
  const delivery = read("dashboard/src/lib/escalationDelivery.ts");
  const live = read("dashboard/src/lib/deskLiveTransfer.ts");
  const verbs = read("dashboard/src/lib/inboxListVerbs.ts");
  const accept = read("docs/product/TICKET_CHAT_FOLLOWUPS_ACCEPT.md");
  const callDetail = read("docs/frontend/design-system/pages/call-detail.md");

  it("lands the ACCEPT spec", () => {
    assert.match(accept, /\*\*Status:\*\* ACCEPT/);
    assert.match(accept, /Hide full bottom nav on mobile ticket chat/);
    assert.match(accept, /No em dashes in owner-facing ticket copy/);
    assert.match(accept, /Remove AI-generic chrome on ticket/);
    assert.match(accept, /Honesty chips unchanged/);
  });

  it("treats only /calls/[id] as ticket chat", () => {
    const got = loadHelper();
    assert.equal(got.list, false);
    assert.equal(got.ticket, true);
    assert.equal(got.slash, true);
    assert.equal(got.nested, false);
    assert.equal(got.query, true);
    assert.equal(got.contacts, false);
    assert.equal(got.home, false);
    assert.equal(got.empty, false);
    assert.equal(got.nil, false);
    assert.match(helper, /export function isDeskTicketChatPath/);
    assert.match(nav, /isDeskNestedPath\(pathname\)/);
    assert.match(nav, /return null/);
  });

  it("hides the phone tab bar on ticket chat and keeps DeskBack", () => {
    assert.match(ticket, /data-ticket-chat/);
    assert.match(ticket, /<DeskBack href=\{backHref\}>Inbox<\/DeskBack>/);
    assert.match(css, /desk-theme:has\(\[data-ticket-chat\]\)[\s\S]{0,160}--desk-tabbar-h:\s*0px/);
    assert.match(css, /\[data-desk-tabbar\]/);
    assert.match(nav, /export function DeskRail/);
    assert.match(nav, /md:flex/);
    assert.match(nav, /md:hidden/);
    assert.match(callDetail, /hides the bottom tab bar/);
    assert.doesNotMatch(callDetail, /Bottom tabs stay\./);
  });

  it("replaces em and en dashes with a plain hyphen", () => {
    const got = loadHelper();
    assert.equal(got.em, "Very short call - little conversation");
    assert.equal(got.en, "Needs human - notify failed");
    assert.equal(got.plain, "Visit saved");
    assert.equal(got.emptyCopy, "");
    assert.equal(got.nilCopy, "");
    assert.match(ticket, /plainOwnerCopy/);
    assert.match(transcript, /plainOwnerCopy/);
    assert.doesNotMatch(ticket, /[\u2014\u2013]/);
    assert.doesNotMatch(dock, /[\u2014\u2013]/);
    assert.doesNotMatch(transcript, /[\u2014\u2013]/);
    assert.doesNotMatch(action, /[\u2014\u2013]/);
  });

  it("drops FAQ ideas, Ask AI, and sparkle chrome from the ticket", () => {
    assert.doesNotMatch(ticket, /CallFaqSuggestions/);
    assert.doesNotMatch(ticket, /FAQ ideas/);
    assert.doesNotMatch(ticket, /Find FAQ ideas/);
    assert.doesNotMatch(ticket, /Ask AI/);
    assert.doesNotMatch(ticket, /How can I help/);
    assert.doesNotMatch(ticket, /tenantId/);
    assert.doesNotMatch(dock, /sparkle/i);
    assert.match(dock, /polishInboxSmsAction/);
    assert.match(dock, /WandGlyph/);
    assert.match(callDetail, /No FAQ ideas/);
    assert.match(callDetail, /Polish tightens the draft/);
    assert.match(callDetail, /One vertical conversation stream/);
  });

  it("keeps the action dock, contact strip, and honesty chips", () => {
    assert.match(ticket, /<InboxTicketActionDock/);
    assert.match(ticket, /<ContactStrip/);
    assert.match(ticket, /InboxPurposeChip/);
    assert.match(action, /Mark done/);
    assert.match(action, /label="Call"/);
    assert.match(action, /label="WhatsApp"/);
    assert.match(verbs, /Mark done lives on the action dock/);
    assert.match(delivery, /Needs human\. Notify failed\./);
    assert.match(live, /Notify only \(live connect unavailable\)/);
    assert.match(delivery, /Never "Escalation sent"/);
    assert.doesNotMatch(delivery, /line: "Escalation sent"/);
  });
});
