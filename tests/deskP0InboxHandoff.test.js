const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { deriveCallSummary } = require("../src/conversation/callSummary");
const {
  createBrainState,
  observeCallerTurn,
  recordActionResults,
} = require("../src/conversation/brainState");
const { shapeEscalationNotifyOutcome } = require("../src/conversation/escalationFeature");

function read(rel) {
  return fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
}

describe("P0 #1 ticket Mark done", () => {
  const verbs = read("dashboard/src/lib/inboxListVerbs.ts");
  const ticket = read("dashboard/src/components/InboxTicketView.tsx");

  it("offers Mark done on the ticket action dock with the list handler", () => {
    const dock = read("dashboard/src/components/InboxTicketActionDock.tsx");
    assert.match(verbs, /export function inboxTicketCanMarkDone/);
    assert.match(verbs, /id: "mark_done", label: "Mark done"/);
    assert.match(ticket, /<InboxTicketActionDock/);
    assert.match(ticket, /canMarkDone=\{canMarkDone\}/);
    assert.match(dock, /updateLeadStatus\(callId, "resolved"\)/);
  });

  it("keeps Archive and hides Mark done on visits, holds, and archived", () => {
    assert.match(verbs, /if \(opts\.hasJob \|\| opts\.hasHold\) return false/);
    assert.match(verbs, /id: "archive"/);
    assert.match(verbs, /id: "unarchive"/);
  });
});

describe("P0 #2 WhatsApp write-back", () => {
  const link = read("dashboard/src/components/WhatsAppLink.tsx");
  const actions = read("dashboard/src/app/(desk)/calls/actions.ts");
  const row = read("dashboard/src/components/InboxItemRow.tsx");
  const ticket = read("dashboard/src/components/InboxTicketView.tsx");
  const dock = read("dashboard/src/components/InboxTicketActionDock.tsx");
  const note = read("dashboard/src/lib/whatsappFollowUp.ts");

  it("keeps wa.me and writes resolved plus follow-up note on click", () => {
    assert.match(link, /https:\/\/wa\.me\//);
    assert.match(link, /callId/);
    assert.match(link, /logWhatsAppFollowUp\(callId\)/);
    assert.match(actions, /lead_status: "resolved"/);
    assert.match(note, /WhatsApp follow-up opened/);
    assert.match(row, /callId=\{item\.callId\}/);
    assert.match(ticket, /callId=\{callId\}/);
    assert.match(dock, /variant="icon"/);
    assert.match(dock, /callId=\{callId\}/);
  });
});

describe("P0 #3 Connect live call honesty", () => {
  const handoff = read("dashboard/src/lib/handoffMode.ts");
  const form = read("dashboard/src/components/TenantForm.tsx");
  const server = read("server.js");

  it("never promises Rings when the executor is off", () => {
    assert.match(handoff, /Messages a teammate\./);
    assert.doesNotMatch(handoff, /Rings a team phone during open hours/);
    assert.doesNotMatch(handoff, /Coming soon/);
    assert.match(form, /handoffMessageLine\(liveDest\.name\)/);
    assert.match(form, /liveTransferExecutor/);
    assert.match(form, /liveTransferExecutor\s*\?\s*liveDest/);
    assert.match(form, /Messages a teammate\./);
    assert.doesNotMatch(form, /Coming soon/);
  });

  it("stamps notify-only when live_transfer did not run", () => {
    assert.match(server, /Notify only \(live connect unavailable\)/);
    assert.match(server, /function liveConnectMetaPatch/);
    assert.match(server, /parseHandoffMode\(profile\?\.handoffMode\) !== 'live_transfer'/);
  });
});

describe("P0 #4 escalation delivery truth", () => {
  const server = read("server.js");
  const ticket = read("dashboard/src/components/InboxTicketView.tsx");
  const delivery = read("dashboard/src/lib/escalationDelivery.ts");

  it("persists failed when no live channel and does not mark sent", () => {
    assert.match(server, /No live SMS\/WA\/email channel\./);
    assert.match(server, /sent\.reason \|\| 'No live SMS\/WA\/email channel\.'/);
    assert.doesNotMatch(
      server,
      /No live SMS\/WA\/email channel[\s\S]{0,400}markEscalationSent/
    );
    assert.match(delivery, /Needs human\. Notify failed\./);
    assert.match(ticket, /escalationDelivery/);
  });

  it("shapes a missing channel as failed, not notified", () => {
    const failed = shapeEscalationNotifyOutcome({
      ok: false,
      reason: "No live SMS/WA/email channel.",
    });
    assert.equal(failed.ok, false);
    assert.equal(failed.stage, "failed");
    assert.equal(failed.soft, false);
  });

  it("summarizes a failed escalate as notify failed, not Escalation sent", () => {
    let state = observeCallerTurn(createBrainState(), {
      text: "I need the manager",
      detectedLanguage: "en",
      resolvedLanguage: "en",
    });
    state.intent = "human";
    state = recordActionResults(state, [
      {
        action: "escalate",
        status: "failed",
        fingerprint: "e1",
        reason: "No live SMS/WA/email channel.",
      },
    ]);
    const summary = deriveCallSummary({ brainState: state });
    assert.ok(summary.actions.some((row) => /Notify failed/i.test(row)));
    assert.ok(!summary.actions.some((row) => /Escalation sent/i.test(row)));
  });
});

describe("P0 #5 desk ping teammate", () => {
  const ping = read("dashboard/src/components/InboxPingTeammate.tsx");
  const action = read("dashboard/src/app/(desk)/calls/escalateActions.ts");
  const server = read("server.js");
  const ticket = read("dashboard/src/components/InboxTicketView.tsx");

  it("pings Escalate-flagged people only through the voice notify path", () => {
    assert.match(ticket, /InboxTicketActionDock/);
    assert.match(ping, /Ping teammate/);
    assert.match(ping, /variant === "dock"/);
    assert.match(action, /receives_escalation === true/);
    assert.match(action, /Escalate is off for that person/);
    assert.match(action, /\/internal\/desk\/escalate/);
    assert.match(server, /app\.post\('\/internal\/desk\/escalate'/);
    assert.match(server, /force: req\.body\?\.force !== false/);
    assert.match(server, /const force = escalate\.force === true/);
    assert.match(server, /kind: 'escalation',\s*force,/);
  });
});
