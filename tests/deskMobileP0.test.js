// Phone inbox identity, 16px fields, and a usable call recording player.
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

function read(rel) {
  return fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
}

describe("mobile P0", () => {
  const inbox = read("dashboard/src/components/InboxItemRow.tsx");
  const phone = inbox.slice(inbox.indexOf("export function InboxPhoneRow"));
  const css = read("dashboard/src/app/globals.css");
  const root = read("dashboard/src/app/layout.tsx");
  const player = read("dashboard/src/components/CallAudioPlayer.tsx");

  it("keeps the caller name visible and the time off the Call button", () => {
    assert.match(phone, /flex min-w-0 flex-col gap-0\.5 sm:flex-row/);
    assert.match(phone, /min-w-0 sm:flex-1 text-sm tracking-tight/);
    assert.match(phone, /overflow-hidden/);
    assert.doesNotMatch(phone, /min-w-\[5\.5rem\] shrink-0/);
    assert.match(phone, /<InboxTrailingAction item=\{item\} message=\{message\} \/>/);
  });

  it("uses 16px desk fields on phone and leaves zoom on", () => {
    assert.match(css, /@media \(max-width: 768px\)/);
    assert.match(css, /font-size: 16px/);
    assert.match(css, /type="search"|input:not/);
    assert.doesNotMatch(root, /userScalable|maximumScale|user-scalable|maximum-scale/);
    assert.doesNotMatch(css, /user-scalable\s*:\s*no|maximum-scale\s*:\s*1/);
  });

  it("stacks the recording player above the speed chips on a narrow phone", () => {
    const audioAt = player.indexOf("<audio");
    const chipsAt = player.indexOf('aria-label="Playback speed"');
    assert.ok(audioAt > -1 && chipsAt > audioAt);
    assert.match(player, /flex-col gap-2 md:flex-row/);
    assert.match(player, /block h-12 w-full max-w-full shrink-0/);
    assert.doesNotMatch(player, /min-w-0 flex-1/);
    assert.match(css, /audio\[controls\]/);
    assert.match(css, /min-height: 3rem/);
  });
});
