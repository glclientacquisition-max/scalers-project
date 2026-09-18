const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

function read(rel) {
  return fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
}

describe("desk resilience and anti-slop", () => {
  it("ships crash, loading, and 404 states without leaking diagnostics", () => {
    const deskError = read("dashboard/src/app/(desk)/error.tsx");
    const rootError = read("dashboard/src/app/error.tsx");
    const globalError = read("dashboard/src/app/global-error.tsx");
    const loading = read("dashboard/src/app/(desk)/loading.tsx");
    const notFound = read("dashboard/src/app/not-found.tsx");
    const crash = read("dashboard/src/components/ui/DeskCrash.tsx");
    assert.match(deskError, /DeskCrash/);
    assert.match(rootError, /DeskCrash/);
    assert.match(globalError, /Could not load Scalers/);
    assert.match(globalError, /Try again/);
    assert.doesNotMatch(globalError, /error\.message|stack/);
    assert.match(loading, /pendingSpinnerInkClass/);
    assert.doesNotMatch(loading, /skeleton|KES|85 to return/);
    assert.match(notFound, /Page not found/);
    assert.match(notFound, /href="\/home"/);
    assert.match(crash, /Try again/);
    assert.doesNotMatch(crash, /error\.message/);
  });

  it("does not print login env leaks or untrusted error query text", () => {
    const login = read("dashboard/src/app/login/page.tsx");
    const route = read("dashboard/src/app/api/login/route.ts");
    assert.doesNotMatch(login, /decodeURIComponent\(sp\.error\)/);
    assert.match(login, /Sign in is not available/);
    assert.match(route, /error=config/);
    assert.doesNotMatch(route, /Supabase Auth env vars are missing/);
  });

  it("drops the Home left-stripe card and indigo email token", () => {
    const home = read("dashboard/src/app/(desk)/home/page.tsx");
    const css = read("dashboard/src/app/globals.css");
    assert.doesNotMatch(home, /left-0 w-1 bg-accent/);
    assert.doesNotMatch(css, /#4f46e5|#a5b4fc|#6366f1/);
    assert.match(css, /--email: #005ccc;/);
  });

  it("treats Home inbox failure and missing workspace as designed states", () => {
    const home = read("dashboard/src/app/(desk)/home/page.tsx");
    const empty = read("dashboard/src/components/ui/DeskNoWorkspace.tsx");
    const offline = read("dashboard/src/components/ui/DeskOffline.tsx");
    const layout = read("dashboard/src/app/(desk)/layout.tsx");
    const call = read("dashboard/src/app/(desk)/calls/[id]/page.tsx");
    const contact = read("dashboard/src/app/(desk)/contacts/[id]/page.tsx");
    const load = read("dashboard/src/lib/inboxLoad.ts");
    const callsPage = read("dashboard/src/components/InboxWorkspace.tsx");
    assert.match(home, /inbox\.error/);
    assert.match(home, /Could not load Overview/);
    assert.match(home, /DeskNoWorkspace/);
    assert.doesNotMatch(home, /No workspace linked to this account yet/);
    assert.match(empty, /No workspace/);
    assert.match(empty, /href="\/signup"/);
    assert.match(offline, /No connection/);
    assert.match(offline, /navigator\.onLine/);
    assert.match(layout, /DeskOffline/);
    assert.match(call, /Could not load this call/);
    assert.match(call, /if \(!call\) notFound/);
    assert.match(contact, /Could not load this contact/);
    assert.match(contact, /if \(!contact\) notFound/);
    assert.match(load, /partialError/);
    assert.match(load, /Could not load some inbox rows/);
    assert.match(home, /inbox\.partialError/);
    assert.match(callsPage, /partialError/);
  });

  it("keeps one filled primary on visit and hold editors", () => {
    const hold = read("dashboard/src/components/InboxHoldEditor.tsx");
    const job = read("dashboard/src/components/InboxJobEditor.tsx");
    assert.match(hold, /btnGhost/);
    assert.doesNotMatch(hold, /btnPrimary/);
    assert.match(job, /btnGhost/);
    assert.doesNotMatch(job, /btnPrimary/);
  });
});
