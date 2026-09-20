const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

/**
 * Desk UX slice of bookings+holds honesty P0.
 * K4: gate hospitality Confirm booking until reservations exist.
 * A1: requested visit is Confirm language; open hold is Hold Done.
 * Keep in lockstep with dashboard/src/lib/inboxNiche.ts and whose-turn.
 */
function read(rel) {
  return fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
}

function sliceHospitalityNiche(src) {
  const start = src.indexOf("hospitality: {");
  const home = src.indexOf("home_services: {");
  const general = src.indexOf("general: {");
  assert.ok(start >= 0 && general > start, "hospitality niche block");
  const end = general;
  const block = src.slice(start, end);
  assert.ok(!block.includes("home_services"), "hospitality slice stayed in hospitality");
  assert.ok(home >= 0 && home < start, "home_services precedes hospitality");
  return block;
}

function sliceHomeServicesNiche(src) {
  const start = src.indexOf("home_services: {");
  const hospitality = src.indexOf("hospitality: {");
  assert.ok(start >= 0 && hospitality > start, "home_services niche block");
  return src.slice(start, hospitality);
}

describe("bookings + holds honesty desk copy", () => {
  const niche = read("dashboard/src/lib/inboxNiche.ts");
  const verbs = read("dashboard/src/lib/inboxListVerbs.ts");
  const holdActions = read("dashboard/src/components/RequestStatusToggle.tsx");
  const jobActions = read("dashboard/src/components/InboxJobActions.tsx");
  const home = read("dashboard/src/app/(desk)/home/page.tsx");

  it("gates hospitality Confirm booking until reservations exist (K4)", () => {
    assert.match(niche, /export const HOSPITALITY_RESERVATIONS_EXIST = false/);
    assert.match(niche, /HOSPITALITY_RESERVATION_AFFORDANCES/);
    assert.match(niche, /jobCtaOne: "Confirm booking"/);
    assert.match(niche, /confirmStamp: "Confirm booking"/);
    const hospitality = sliceHospitalityNiche(niche);
    assert.match(hospitality, /jobCtaOne: "Confirm visit"/);
    assert.match(hospitality, /jobCtaMany: "Confirm visits"/);
    assert.match(hospitality, /confirmStamp: "Confirm visit"/);
    assert.match(hospitality, /visitGhostStamp: "Visit not booked"/);
    assert.doesNotMatch(hospitality, /Confirm booking/);
    assert.doesNotMatch(hospitality, /Confirm bookings/);
    assert.doesNotMatch(hospitality, /Booking not booked/);
    assert.match(niche, /HOSPITALITY_RESERVATIONS_EXIST[\s\S]*HOSPITALITY_RESERVATION_AFFORDANCES/);
    const homeServices = sliceHomeServicesNiche(niche);
    assert.match(homeServices, /jobCtaOne: "Confirm visit"/);
    assert.match(homeServices, /confirmStamp: "Confirm visit"/);
    assert.doesNotMatch(homeServices, /Confirm booking/);
  });

  it("keeps requested-visit whose-turn on Confirm, not booked (A1)", () => {
    assert.match(verbs, /recipe === "confirm"[\s\S]*confirmStamp/);
    assert.match(verbs, /recipe === "hold_done"[\s\S]*"Hold Done"/);
    assert.doesNotMatch(verbs, /booked/);
    const hospitality = sliceHospitalityNiche(niche);
    assert.match(hospitality, /confirmStamp: "Confirm visit"/);
    assert.doesNotMatch(hospitality, /booked a visit|you're booked|Confirm booking/);
  });

  it("uses Hold Done on Home CTAs and the ticket banner (A1)", () => {
    assert.match(niche, /holdCtaOne: "Hold Done"/);
    assert.match(niche, /holdCtaMany: "Hold Done"/);
    assert.doesNotMatch(niche, /Fulfill hold/);
    assert.match(home, /copy\.holdCtaOne/);
    assert.match(home, /copy\.holdCtaMany/);
    assert.match(holdActions, /wide \? "Hold Done" : "Done"/);
    assert.match(jobActions, /"Confirm"/);
    assert.doesNotMatch(jobActions, /Confirm booking/);
  });
});
