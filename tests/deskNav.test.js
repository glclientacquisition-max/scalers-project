const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("path");

/**
 * Keep in sync with dashboard/src/lib/deskNav.ts
 */
const DESK_NAV_LINKS = [
  { href: "/home", label: "Overview" },
  { href: "/calls", label: "Calls" },
  { href: "/requests", label: "Requests" },
  { href: "/appointments", label: "Appointments" },
  { href: "/settings", label: "Business" },
  { href: "/wallet", label: "Wallet" },
];

const DESK_MOBILE_MORE = [
  { href: "/appointments", label: "Appointments" },
  { href: "/settings", label: "Business" },
  { href: "/wallet", label: "Wallet" },
];

function isDeskHrefActive(pathname, href) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

function isDeskMoreActive(pathname) {
  return DESK_MOBILE_MORE.some((item) => isDeskHrefActive(pathname, item.href));
}

function deskNavLabelForPath(pathname) {
  const match = DESK_NAV_LINKS.find((item) => isDeskHrefActive(pathname, item.href));
  return match ? match.label : null;
}

function read(rel) {
  return fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
}

describe("desk navigation (Phase 6B)", () => {
  const helper = read("dashboard/src/lib/deskNav.ts");
  const nav = read("dashboard/src/components/DeskNav.tsx");
  const layout = read("dashboard/src/app/(desk)/layout.tsx");
  const globals = read("dashboard/src/app/globals.css");
  const audio = read("dashboard/src/components/CallAudioPlayer.tsx");

  it("classifies nested routes to the parent destination", () => {
    assert.equal(deskNavLabelForPath("/home"), "Overview");
    assert.equal(deskNavLabelForPath("/calls"), "Calls");
    assert.equal(deskNavLabelForPath("/calls/123"), "Calls");
    assert.equal(deskNavLabelForPath("/requests"), "Requests");
    assert.equal(deskNavLabelForPath("/appointments"), "Appointments");
    assert.equal(deskNavLabelForPath("/settings"), "Business");
    assert.equal(deskNavLabelForPath("/wallet"), "Wallet");
    assert.equal(isDeskHrefActive("/calls/abc", "/calls"), true);
    assert.equal(isDeskHrefActive("/callsarchive", "/calls"), false);
    assert.equal(isDeskHrefActive("/home", "/calls"), false);
  });

  it("marks Appointments, Business, and Wallet as mobile More", () => {
    assert.equal(isDeskMoreActive("/home"), false);
    assert.equal(isDeskMoreActive("/calls"), false);
    assert.equal(isDeskMoreActive("/calls/123"), false);
    assert.equal(isDeskMoreActive("/requests"), false);
    assert.equal(isDeskMoreActive("/appointments"), true);
    assert.equal(isDeskMoreActive("/settings"), true);
    assert.equal(isDeskMoreActive("/settings/ignored"), true);
    assert.equal(isDeskMoreActive("/wallet"), true);
  });

  it("keeps desktop six-item top bar and mobile Overview/Calls/Requests/More", () => {
    assert.match(helper, /href: "\/home", label: "Overview"/);
    assert.match(helper, /DESK_MOBILE_PRIMARY/);
    assert.match(helper, /DESK_MOBILE_MORE/);
    assert.match(nav, /hidden items-center gap-5 text-sm md:flex/);
    assert.match(nav, /DESK_NAV_LINKS\.map/);
    assert.match(nav, /DESK_MOBILE_PRIMARY\.map/);
    assert.match(nav, />\s*More\s*</);
    assert.match(nav, /aria-expanded=\{moreOpen\}/);
    assert.match(nav, /aria-controls="desk-more-nav"/);
    assert.match(nav, /fixed inset-x-0 bottom-0 z-50 md:hidden/);
    assert.doesNotMatch(nav, /\{open \? "Close" : "Menu"\}/);
    assert.match(layout, /<DeskNav \/>/);
    assert.match(layout, /<DeskMobileNav \/>/);
  });

  it("does not add badges, Online, or a Receptionist tab", () => {
    assert.doesNotMatch(nav, /badge|unread|Online|AI active|Receptionist/);
    assert.doesNotMatch(helper, /Receptionist|Online/);
    assert.doesNotMatch(nav, /Conversations/);
  });

  it("insets content and the call audio player above the mobile bar", () => {
    assert.match(globals, /--desk-bottom-nav-h/);
    assert.match(globals, /env\(safe-area-inset-bottom/);
    assert.match(layout, /var\(--desk-bottom-nav-h/);
    assert.match(nav, /pb-\[env\(safe-area-inset-bottom,0px\)\]/);
    assert.match(audio, /bottom-\[var\(--desk-bottom-nav-h,0px\)\]/);
    assert.match(nav, /min-h-12/);
    assert.match(nav, /focus-visible:ring-\[#0096FF\]\/40/);
  });
});
