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
  const cards = read("dashboard/src/components/ContactPileCards.tsx");
  const profile = read("dashboard/src/app/(desk)/contacts/[id]/page.tsx");
  const button = read("dashboard/src/components/ContactFavouriteButton.tsx");
  const actions = read("dashboard/src/app/(desk)/contacts/actions.ts");
  const helpers = read("dashboard/src/lib/contactFavourite.ts");
  const note = read("docs/frontend/design-system/pages/contacts.md");
  const nav = read("dashboard/src/components/DeskNav.tsx");

  it("keeps All Saved Unsaved pills and puts Recents Favourites on rate cards", () => {
    assert.match(page, /<InboxFilterPills/);
    assert.match(page, /label: "All"/);
    assert.match(page, /label: "Saved"/);
    assert.match(page, /label: "Unsaved"/);
    assert.doesNotMatch(page, /label: "Recent"/);
    assert.doesNotMatch(page, /saved: "recent"/);
    assert.match(page, /<ContactPileCards/);
    assert.match(page, /contactsRecentsHref/);
    assert.match(page, /contactsFavouritesHref/);
    assert.match(cards, /title: "Recents"/);
    assert.match(cards, /title: "Favourites"/);
    assert.match(cards, /data-contact-pile-cards/);
    assert.match(note, /All · Saved · Unsaved only/);
    assert.match(note, /ContactPileCards/);
    assert.match(note, /No Recent tab/);
    assert.doesNotMatch(nav, /Favourites|Recents/);
  });

  it("lets the person file star a contact on metadata.favourite_at", () => {
    assert.match(profile, /<ContactFavouriteButton/);
    assert.match(profile, /isContactFavourite\(contact\.metadata\)/);
    assert.match(button, /Add to Favourites/);
    assert.match(button, /Remove from Favourites/);
    assert.match(actions, /export async function updateContactFavourite/);
    assert.match(actions, /withContactFavourite/);
    assert.match(helpers, /favourite_at/);
    assert.doesNotMatch(helpers, /[\u2014\u2013]/);
    assert.doesNotMatch(button, /[\u2014\u2013]/);
    assert.doesNotMatch(profile, /Telegram|Videomessage|Block this/);
  });
});
