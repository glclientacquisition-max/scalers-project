// Universal conversation row: identity circle, state dot, weight-by-state.

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

function read(rel) {
  return fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
}

describe("universal row anatomy", () => {
  const row = read("dashboard/src/components/ui/deskRow.tsx");
  const inbox = read("dashboard/src/components/InboxItemRow.tsx");
  const avatar = read("dashboard/src/components/InboxRowAvatar.tsx");
  const contacts = read("dashboard/src/app/(desk)/contacts/page.tsx");
  const master = read("docs/frontend/design-system/MASTER.md");

  it("ships the shared primitives", () => {
    assert.match(row, /export function RowIdentity/);
    assert.match(row, /export function RowStateDot/);
    assert.match(row, /export function deskRowInitials/);
    assert.match(row, /export function deskRowWeightClass/);
    assert.match(master, /RowIdentity/);
    assert.match(master, /RowStateDot/);
  });

  it("keeps the identity circle neutral and state-free", () => {
    assert.match(row, /border border-line bg-surface-muted text-xs font-semibold text-ink-soft/);
    // No per-name rainbow: the circle never hashes a name into a color.
    assert.doesNotMatch(row, /hash|hsl\(|palette/i);
  });

  it("carries state as a blue dot plus type weight, never opacity", () => {
    assert.match(row, /rounded-full bg-accent/);
    assert.match(row, /aria-label="Unread"/);
    assert.match(row, /font-semibold text-ink/);
    assert.match(row, /font-medium text-ink/);
    assert.doesNotMatch(inbox, /opacity-\[0\.92\]/);
  });

  it("applies the anatomy to Inbox phone and table rows", () => {
    const who = inbox.match(/<InboxRowWho /g) || [];
    assert.equal(who.length, 3, `InboxRowWho in 3 table kinds, got ${who.length}`);
    const phone = inbox.slice(inbox.indexOf("export function InboxPhoneRow"));
    assert.match(phone, /<InboxRowAvatar/);
    assert.match(avatar, /RowIdentity name=\{name\}/);
    assert.match(inbox, /RowStateDot show=\{item\.unread\}/);
    assert.match(inbox, /deskRowWeightClass\(item\.unread\)/);
    assert.match(inbox, /deskPreviewClass/);
    assert.match(inbox, /deskPreviewCellClass/);
    assert.doesNotMatch(inbox, /line-clamp-2/);
    assert.doesNotMatch(inbox, /item\.detail/);
  });

  it("applies the identity circle to Contacts mobile and desktop", () => {
    const list = read("dashboard/src/components/ContactListRow.tsx");
    const uses = list.match(/RowIdentity/g) || [];
    assert.ok(uses.length >= 3, `import + mobile + desktop, got ${uses.length}`);
    assert.match(contacts, /<ContactPhoneRow/);
    assert.match(contacts, /<ContactTableRow/);
  });

  it("initials skip phone numbers and placeholders", () => {
    assert.match(row, /\^\\\+\?\[\\d\\s\(\)-\]/);
  });
});

describe("inbox call action", () => {
  const call = read("dashboard/src/components/CallLink.tsx");
  const inbox = read("dashboard/src/components/InboxItemRow.tsx");
  const master = read("docs/frontend/design-system/MASTER.md");

  it("is a tel: deep link with E.164 plus prefix", () => {
    assert.match(call, /export function telHref/);
    assert.match(call, /tel:\+\$\{digits\}/);
    assert.match(call, /replace\(\/\\D\/g, ""\)/);
  });

  it("is a muted 44px icon button, never filled", () => {
    assert.match(call, /deskHitClass/);
    assert.match(read("dashboard/src/components/ui/deskChrome.ts"), /h-12 w-12/);
    assert.match(call, /aria-label=\{`Call \$\{number\}`\}/);
    assert.match(call, /data-icon="handset"/);
    assert.match(call, /stroke="currentColor"/);
    assert.doesNotMatch(call, /M1\.5 4\.5a3 3 0 0 1 3-3h1\.372/);
    assert.doesNotMatch(call, /bg-\[#0096FF\]|bg-whatsapp/);
  });

  it("sits left of the WhatsApp icon in the inbox trailing dock", () => {
    assert.match(inbox, /import \{ CallLink \} from "@\/components\/CallLink"/);
    const dock = inbox.indexOf("<CallLink number={item.callerPhone} />");
    const wa = inbox.indexOf('variant="icon"');
    assert.ok(dock > -1 && wa > -1 && dock < wa, "CallLink before WhatsApp icon");
    assert.match(master, /`CallLink`/);
    assert.match(master, /Inbox Action dock/);
    assert.match(inbox, /Visit requested → Confirm\. Confirmed visit → Done\. Hold → Done/);
    const actionFn = inbox.indexOf("function InboxTrailingAction");
    const recipeAt = inbox.indexOf("inboxListDockRecipe(item)", actionFn);
    const confirmAt = inbox.indexOf('recipe === "confirm"', actionFn);
    const holdAt = inbox.indexOf('recipe === "hold_done"', actionFn);
    const phoneAt = inbox.indexOf('recipe === "call_wa"', actionFn);
    assert.ok(recipeAt > -1 && confirmAt > recipeAt && holdAt > confirmAt && phoneAt > holdAt);
    assert.doesNotMatch(inbox.slice(actionFn, actionFn + 1600), /Send SMS|mailto:/);
    assert.match(inbox, /flex shrink-0 items-center justify-end gap-2/);
    assert.match(read("dashboard/src/components/InboxJobActions.tsx"), /btnDock/);
    assert.match(read("dashboard/src/components/RequestStatusToggle.tsx"), /btnDock/);
    assert.match(call, /DeskHint label="Call"/);
    assert.match(read("dashboard/src/components/WhatsAppLink.tsx"), /DeskHint label="WhatsApp"/);
  });
});
