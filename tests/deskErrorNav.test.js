const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

function read(rel) {
  return fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
}

const DASH = /[—–]/;

describe("desk error navigation", () => {
  it("keeps the desk 404 in the shell and does not add a route loading file", () => {
    const desk = read("dashboard/src/app/(desk)/not-found.tsx");
    assert.match(desk, /Page not found/);
    assert.match(desk, /That address is not a Scalers page\./);
    assert.match(desk, /href="\/home"/);
    assert.match(desk, /Overview/);
    assert.doesNotMatch(desk, DASH);
    assert.doesNotMatch(desk, /Oops/);
    assert.equal(
      fs.existsSync(path.join(__dirname, "..", "dashboard/src/app/(desk)/loading.tsx")),
      false
    );
  });

  it("keeps a missing call or contact in the page slot", () => {
    const call = read("dashboard/src/app/(desk)/calls/[id]/page.tsx");
    const contact = read("dashboard/src/app/(desk)/contacts/[id]/page.tsx");
    assert.doesNotMatch(call, /notFound\s*\(/);
    assert.doesNotMatch(contact, /notFound\s*\(/);
    assert.match(call, /DeskNoWorkspace/);
    assert.match(contact, /DeskNoWorkspace/);
    assert.match(call, /This call is not in the inbox\./);
    assert.match(call, /href="\/calls"/);
    assert.match(call, /action="Inbox"/);
    assert.match(contact, /This contact is not in Contacts\./);
    assert.match(contact, /href="\/contacts"/);
    assert.match(contact, /action="Contacts"/);
    assert.match(call, /backHref="\/calls"/);
    assert.match(call, /backLabel="Inbox"/);
    assert.match(contact, /backHref="\/contacts"/);
    assert.match(contact, /backLabel="Contacts"/);
    for (const list of [
      "dashboard/src/app/(desk)/calls/page.tsx",
      "dashboard/src/app/(desk)/contacts/page.tsx",
      "dashboard/src/app/(desk)/home/page.tsx",
    ]) {
      const tags = read(list).match(/<DeskLoadError[\s\S]*?<\/DeskLoadError>/g) || [];
      assert.ok(tags.length > 0, list);
      for (const tag of tags) {
        assert.doesNotMatch(tag, /backHref|backLabel/);
      }
    }
    assert.doesNotMatch(read("dashboard/src/components/ui/DeskRecovery.tsx"), /Retry/);
    assert.doesNotMatch(call, DASH);
    assert.doesNotMatch(contact, DASH);
  });

  it("picks one root 404 destination from the session", () => {
    const root = read("dashboard/src/app/not-found.tsx");
    assert.match(root, /export const instant = false/);
    assert.match(root, /getAuthUser\(/);
    assert.match(root, /isLegacyAuthenticated\(/);
    assert.match(root, /href = "\/"/);
    assert.match(root, /action = "Home"/);
    assert.match(root, /href = "\/home"/);
    assert.match(root, /action = "Overview"/);
    assert.match(root, /href = "\/admin"/);
    assert.match(root, /action = "Admin"/);
    assert.match(root, /Page not found/);
    assert.match(root, /That address is not a Scalers page\./);
    assert.doesNotMatch(root, /DeskRail|DeskTabBar|redirect\(/);
    assert.doesNotMatch(root, DASH);
  });

  it("says text is unavailable and hides minified React errors", () => {
    const notes = read("dashboard/src/app/(desk)/calls/noteActions.ts");
    const facing = read("dashboard/src/lib/ownerFacingError.ts");
    const crash = read("dashboard/src/components/ui/DeskCrash.tsx");
    assert.match(notes, /Text is unavailable\./);
    assert.doesNotMatch(notes, /SMS is not configured\./);
    assert.match(facing, /MINIFIED_REACT/);
    assert.match(facing, /minified react error/);
    assert.doesNotMatch(crash, /error\.message/);
    assert.doesNotMatch(read("dashboard/src/app/(desk)/error.tsx"), /error\.message/);
    assert.doesNotMatch(read("dashboard/src/app/error.tsx"), /error\.message/);
  });
});
