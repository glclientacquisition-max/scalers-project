const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

function read(rel) {
  return fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
}

describe("ticket action dock", () => {
  const dock = read("dashboard/src/components/InboxTicketActionDock.tsx");
  const ticket = read("dashboard/src/components/InboxTicketView.tsx");
  const ping = read("dashboard/src/components/InboxPingTeammate.tsx");
  const verbs = read("dashboard/src/lib/inboxListVerbs.ts");
  const detail = read("docs/frontend/design-system/pages/call-detail.md");

  it("surfaces Mark done, Call, WhatsApp, and Ping as one dock", () => {
    assert.match(ticket, /<InboxTicketActionDock/);
    assert.match(ticket, /canMarkDone=\{canMarkDone\}/);
    assert.match(ticket, /escalatePeople=\{escalatePeople\}/);
    assert.match(dock, /data-ticket-action-dock/);
    assert.match(dock, /aria-label="Call actions"/);
    assert.match(dock, /updateLeadStatus\(callId, "resolved"\)/);
    assert.match(dock, /<CallLink number=\{callerPhone\} \/>/);
    assert.match(dock, /variant="icon"/);
    assert.match(dock, /callId=\{callId\}/);
    assert.match(dock, /variant="dock"/);
    assert.match(dock, /deskHitClass/);
    assert.match(dock, /label="Done"/);
    assert.match(dock, /label="Call"/);
    assert.match(dock, /label="WhatsApp"/);
    assert.match(ping, />Ping</);
    assert.match(ping, /variant === "dock"/);
    assert.match(ping, /Ping teammate/);
    assert.match(ping, /deskHitClass/);
    assert.doesNotMatch(dock, /[\u2014\u2013]/);
    assert.doesNotMatch(ping, /[\u2014\u2013]/);
    assert.match(dock, /pendingSpinnerInkClass/);
    assert.match(dock, /aria-busy=\{pending\}/);
    assert.doesNotMatch(dock, /useTransition/);
    assert.match(ping, /pendingSpinnerInkClass/);
    assert.match(ping, /aria-busy=\{pending\}/);
    assert.match(ping, /Pinging/);
    assert.doesNotMatch(ping, /useTransition/);
    const escalate = read("dashboard/src/app/(desk)/calls/escalateActions.ts");
    assert.match(escalate, /language: "en"/);
    assert.match(escalate, /revalidatePath\(`\/calls\/\$\{callId\}`\)/);
    assert.doesNotMatch(escalate, /revalidatePath\("\/home"\)/);
    assert.doesNotMatch(escalate, /revalidatePath\("\/calls"\)/);
  });

  it("keeps Archive on More and leaves lead_status rules in the shipped helpers", () => {
    assert.match(ticket, /inboxTicketOverflowActions\(\{ archived \}\)/);
    assert.match(ticket, /id === "unarchive" \|\| archived \? "new" : "archived"/);
    assert.doesNotMatch(ticket, /id === "mark_done"/);
    assert.match(verbs, /Mark done lives on the action dock/);
    assert.match(verbs, /if \(opts\.hasJob \|\| opts\.hasHold\) return false/);
    assert.match(verbs, /opts\.purpose !== "human" && opts\.purpose !== "missed"/);
    assert.doesNotMatch(dock, /lead_status: "resolved"/);
    assert.doesNotMatch(dock, /updateLeadStatus\(callId, "archived"\)/);
    assert.doesNotMatch(dock, /notifyChannels/);
  });

  it("sits under the split, above Confirm and SMS, and uses 48px hits", () => {
    const dockAt = ticket.indexOf("<InboxTicketActionDock");
    const confirmAt = ticket.indexOf("canConfirm && job");
    const smsAt = ticket.indexOf("<InboxSmsDock");
    assert.ok(dockAt > 0 && confirmAt > dockAt && smsAt > confirmAt);
    assert.match(ticket, /pb-\[calc\(var\(--desk-tabbar-h\)\+env\(safe-area-inset-bottom,0px\)\)\]/);
    assert.match(dock, /deskHitClass/);
    assert.match(read("dashboard/src/components/ui/deskChrome.ts"), /h-12 w-12 min-h-12 min-w-12/);
    assert.match(detail, /Action dock/);
    assert.match(detail, /safe-area-inset-bottom/);
    assert.doesNotMatch(ticket, /<CallLink number=\{callerPhone\} \/>/);
    assert.doesNotMatch(ticket, /<WhatsAppLink/);
    assert.doesNotMatch(ticket, /<InboxPingTeammate/);
  });
});
