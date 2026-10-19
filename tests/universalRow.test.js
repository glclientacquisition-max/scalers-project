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
  const master = read("docs/reference/design-system/MASTER.md");

  it("ships the shared primitives", () => {
    assert.match(row, /export function RowIdentity/);
    assert.match(row, /export function RowStateDot/);
    assert.match(row, /export function InboxPinMark/);
    assert.match(row, /export function deskRowInitials/);
    assert.match(row, /export function deskRowWeightClass/);
    assert.match(master, /RowIdentity/);
    assert.match(master, /RowStateDot/);
    assert.match(master, /InboxPinMark/);
  });

  it("keeps the identity circle neutral and state-free", () => {
    assert.match(row, /border border-hairline bg-surface-muted text-meta font-semibold text-ink-2/);
    // No per-name rainbow: the circle never hashes a name into a color.
    assert.doesNotMatch(row, /hash|hsl\(|palette/i);
  });

  it("carries state as a blue dot plus type weight, never opacity", () => {
    assert.match(row, /rounded-full bg-brand/);
    assert.match(row, /data-unread-slot/);
    assert.match(row, /h-2\.5 w-2\.5/);
    assert.match(row, /h-2 w-2/);
    assert.match(row, /aria-hidden/);
    assert.doesNotMatch(row, /aria-label="Unread"/);
    assert.match(inbox, /sr-only">Unread/);
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

  it("applies the identity circle to the Contacts row at every width", () => {
    const list = read("dashboard/src/components/ContactListRow.tsx");
    const endless = read("dashboard/src/components/ContactsEndlessList.tsx");
    const inbox = read("dashboard/src/components/InboxItemRow.tsx");
    const phone = inbox.slice(inbox.indexOf("export function InboxPhoneRow"));
    assert.match(list, /<Avatar/);
    assert.match(list, /<ListRow/);
    assert.match(endless, /<ContactPhoneRow/);
    assert.match(endless, /contactListSections/);
    assert.doesNotMatch(endless, /ContactTableRow|DeskDataTable/);
    assert.match(endless, /divide-hairline/);
    assert.match(phone, /gap-3 overflow-hidden border-t border-hairline\/70 px-4 py-3/);
    assert.doesNotMatch(list, /RowStateDot|InboxRowCheck|break-words|overflow-wrap/);
  });

  it("initials skip phone numbers and placeholders", () => {
    assert.match(row, /\^\\\+\?\[\\d\\s\(\)-\]/);
  });
});

describe("inbox call action", () => {
  const call = read("dashboard/src/components/CallLink.tsx");
  const inbox = read("dashboard/src/components/InboxItemRow.tsx");
  const master = read("docs/reference/design-system/MASTER.md");

  it("is a tel: deep link with E.164 plus prefix", () => {
    assert.match(call, /export function telHref/);
    assert.match(call, /tel:\+\$\{digits\}/);
    assert.match(call, /kePhoneDigits\(rawNumber\)/);
  });

  it("is a muted 44px icon button, never filled", () => {
    assert.match(call, /IconButtonAnchor/);
    assert.match(read("dashboard/src/components/ui/deskChrome.ts"), /h-12 w-12/);
    assert.match(call, /label=\{`Call \$\{number\}`\}/);
    assert.match(call, /data-icon="handset"/);
    assert.match(call, /PhoneIcon/);
    assert.doesNotMatch(call, /M1\.5 4\.5a3 3 0 0 1 3-3h1\.372/);
    assert.doesNotMatch(call, /bg-\[#0096FF\]|bg-whatsapp/);
  });

  it("sits left of WhatsApp in the opened item dock; list rows keep Confirm and Done only", () => {
    const dock = read("dashboard/src/components/InboxTicketActionDock.tsx");
    const callAt = dock.indexOf("<CallLink number={callerPhone} />");
    const waAt = dock.indexOf("<WhatsAppLink", callAt);
    assert.ok(callAt > -1 && waAt > callAt, "CallLink before WhatsApp icon");
    assert.match(master, /`CallLink`/);
    assert.match(inbox, /Visit requested → Confirm\. Confirmed visit → Done\. Hold → Done/);
    const actionFn = inbox.indexOf("function InboxTrailingAction");
    const recipeAt = inbox.indexOf("inboxListDockRecipe(item)", actionFn);
    const confirmAt = inbox.indexOf('recipe === "confirm"', actionFn);
    const holdAt = inbox.indexOf('recipe === "hold_done"', actionFn);
    assert.ok(recipeAt > -1 && confirmAt > recipeAt && holdAt > confirmAt);
    assert.doesNotMatch(inbox, /CallLink|WhatsAppLink|call_wa/);
    assert.match(read("dashboard/src/components/InboxJobActions.tsx"), /variant=\{wide \? "primary" : "tonal"\}/);
    assert.match(read("dashboard/src/components/RequestStatusToggle.tsx"), /variant=\{wide \? "primary" : "tonal"\}/);
    assert.match(call, /label=\{`Call \$\{number\}`\}/);
    assert.match(read("dashboard/src/components/WhatsAppLink.tsx"), /tone="whatsapp"/);
  });
});
