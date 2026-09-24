const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

function read(rel) {
  return fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
}

function asMeta(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  return { ...raw };
}

function contactFavouriteAt(metadata) {
  const iso = String(asMeta(metadata).favourite_at || "").trim();
  if (!iso || !Number.isFinite(Date.parse(iso))) return null;
  return iso;
}

function isContactFavourite(metadata) {
  return Boolean(contactFavouriteAt(metadata));
}

function withContactFavourite(metadata, favourite, now = new Date()) {
  const next = asMeta(metadata);
  if (favourite) {
    next.favourite_at = contactFavouriteAt(next) || now.toISOString();
    return next;
  }
  delete next.favourite_at;
  return next;
}

describe("contact favourite metadata", () => {
  it("stars and unstars without dropping other metadata keys", () => {
    const now = new Date("2026-09-23T08:00:00.000Z");
    const starred = withContactFavourite(
      { alternate_names: [{ name: "Ali" }] },
      true,
      now
    );
    assert.equal(starred.favourite_at, "2026-09-23T08:00:00.000Z");
    assert.deepEqual(starred.alternate_names, [{ name: "Ali" }]);
    assert.equal(isContactFavourite(starred), true);
    const kept = withContactFavourite(starred, true, new Date("2026-09-24T08:00:00.000Z"));
    assert.equal(kept.favourite_at, "2026-09-23T08:00:00.000Z");
    const cleared = withContactFavourite(starred, false);
    assert.equal(cleared.favourite_at, undefined);
    assert.deepEqual(cleared.alternate_names, [{ name: "Ali" }]);
    assert.equal(isContactFavourite(cleared), false);
    assert.equal(isContactFavourite({ favourite_at: "not-a-date" }), false);
  });
});

describe("contacts recents and favourites rate cards", () => {
  const page = read("dashboard/src/app/(desk)/contacts/page.tsx");
  const load = read("dashboard/src/lib/contactsLoad.ts");
  const profile = read("dashboard/src/app/(desk)/contacts/[id]/page.tsx");
  const button = read("dashboard/src/components/ContactFavouriteButton.tsx");
  const actions = read("dashboard/src/app/(desk)/contacts/actions.ts");
  const helpers = read("dashboard/src/lib/contactFavourite.ts");
  const note = read("docs/frontend/design-system/pages/contacts.md");
  const nav = read("dashboard/src/components/DeskNav.tsx");

  it("puts Recents Favourites Saved Unsaved on one Inbox filter row", () => {
    assert.match(page, /<InboxFilterPills/);
    assert.match(page, /contactFilterPills/);
    assert.doesNotMatch(page, /<ContactPileStrip/);
    assert.ok(
      !fs.existsSync(path.join(__dirname, "..", "dashboard/src/components/ContactPileStrip.tsx")),
      "duplicate pile strip is gone"
    );
    assert.match(load, /label: "All"/);
    assert.match(load, /label: "Recents"/);
    assert.match(load, /label: "Favourites"/);
    assert.match(load, /label: "Saved"/);
    assert.match(load, /label: "Unsaved"/);
    assert.equal((load.match(/label: "Unsaved"/g) || []).length, 1);
    assert.match(note, /All · Recents · Favourites · Saved · Unsaved/);
    assert.match(note, /Unsaved appears once/);
    assert.doesNotMatch(note, /No Recent tab/);
    assert.doesNotMatch(nav, /Favourites|Recents/);
  });

  it("lets the person file star a contact on metadata.favourite_at", () => {
    assert.match(profile, /<ContactFavouriteButton/);
    assert.match(profile, /isContactFavourite\(contact\.metadata\)/);
    assert.match(button, /Add to Favourites/);
    assert.match(button, /Favourited/);
    assert.match(button, /text-\[#005CCC\] hover:underline/);
    assert.doesNotMatch(button, /bg-surface-muted/);
    assert.match(actions, /export async function updateContactFavourite/);
    assert.match(actions, /withContactFavourite/);
    assert.match(helpers, /favourite_at/);
    assert.doesNotMatch(helpers, /[\u2014\u2013]/);
    assert.doesNotMatch(button, /[\u2014\u2013]/);
    assert.doesNotMatch(profile, /Telegram|Videomessage|Block this/);
  });
});
