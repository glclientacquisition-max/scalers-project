const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const helperPath = path.join(
  __dirname,
  "../dashboard/src/lib/callTranscriptStream.ts"
);

function read(rel) {
  return fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
}

function load() {
  const script = `
    import {
      buildCallTranscriptStream,
      formatTranscriptStamp,
      isHonestTranscriptFact,
    } from ${JSON.stringify(helperPath)};
    const turns = [
      { id: "t1", created_at: "2026-09-12T05:10:01.000Z", speaker: "caller", text_content: "Hi, I need house cleaning tomorrow morning." },
      { id: "t2", created_at: "2026-09-12T05:10:08.000Z", speaker: "agent", text_content: "I can book a visit for tomorrow at 9am." },
      { id: "t3", created_at: "2026-09-12T05:10:16.000Z", speaker: "agent", text_content: "Kericho road still okay?" },
      { id: "t4", created_at: "2026-09-12T05:11:22.000Z", speaker: "caller", text_content: "Yes. Please confirm on WhatsApp." },
      { id: "t5", created_at: "2026-09-12T05:11:28.000Z", speaker: "system", text_content: "Call ended" },
      { id: "t6", created_at: "2026-09-12T05:11:29.000Z", speaker: "system", text_content: "noise" },
      { id: "t7", created_at: "2026-09-12T05:11:30.000Z", speaker: "system", text_content: "[escalate]" },
      { id: "t8", created_at: "2026-09-12T05:11:31.000Z", speaker: "system", text_content: "Escalation sent" },
      { id: "t9", created_at: "2026-09-12T05:11:32.000Z", speaker: "system", text_content: "Needs human. Notify failed." },
      { id: "t10", created_at: "2026-09-12T05:11:33.000Z", speaker: "system", text_content: "SMS to +254700000099. 12 Sep 2026, 08:11" },
    ];
    const stream = buildCallTranscriptStream(turns);
    console.log(JSON.stringify({
      stamp: formatTranscriptStamp("2026-09-12T05:10:01.000Z"),
      badStamp: formatTranscriptStamp("not-a-date"),
      failed: isHonestTranscriptFact("Needs human. Notify failed."),
      sent: isHonestTranscriptFact("SMS to +254700000099. 12 Sep 2026, 08:11"),
      wa: isHonestTranscriptFact("WhatsApp to +254700000099"),
      fake: isHonestTranscriptFact("Escalation sent"),
      ended: isHonestTranscriptFact("Call ended"),
      kinds: stream.map((row) => row.kind),
      ids: stream.map((row) => row.id),
      texts: stream.map((row) => row.kind === "fact" ? row.text : row.text),
      speakers: stream.filter((row) => row.kind === "speech").map((row) => row.speaker),
      clustered: stream.filter((row) => row.kind === "speech").map((row) => row.clustered),
      tails: stream.filter((row) => row.kind === "speech").map((row) => row.tail),
      stamps: stream.filter((row) => row.kind === "speech").map((row) => row.stamp),
      facts: stream.filter((row) => row.kind === "fact").map((row) => row.text),
    }));
  `;
  const ran = spawnSync(
    process.execPath,
    ["--experimental-strip-types", "--input-type=module", "-e", script],
    { encoding: "utf8" }
  );
  assert.equal(ran.status, 0, ran.stderr || ran.stdout);
  return JSON.parse(ran.stdout.trim().split("\n").at(-1));
}

describe("call transcript stream", () => {
  it("keeps one Nairobi stamp per minute and clusters consecutive agent turns", () => {
    const out = load();
    assert.equal(out.stamp, "8:10 AM");
    assert.equal(out.badStamp, null);
    assert.deepEqual(out.speakers, ["caller", "agent", "agent", "caller"]);
    assert.deepEqual(out.clustered, [false, false, true, false]);
    assert.deepEqual(out.tails, [true, false, true, true]);
    assert.deepEqual(out.stamps, ["8:10 AM", null, null, "8:11 AM"]);
  });

  it("keeps Critic-true delivery facts and drops lifecycle and false-sent chrome", () => {
    const out = load();
    assert.equal(out.failed, true);
    assert.equal(out.sent, true);
    assert.equal(out.wa, true);
    assert.equal(out.fake, false);
    assert.equal(out.ended, false);
    assert.deepEqual(out.facts, [
      "Needs human. Notify failed.",
      "SMS to +254700000099. 12 Sep 2026, 08:11",
    ]);
    assert.deepEqual(out.ids, ["t1", "t2", "t3", "t4", "t9", "t10"]);
    assert.ok(!out.texts.includes("Call ended"));
    assert.ok(!out.texts.includes("Escalation sent"));
    assert.ok(!out.texts.includes("[escalate]"));
  });
});

describe("ticket chat display chrome", () => {
  it("lands the ACCEPT spec and leaves dock plus contact strip shipped", () => {
    const spec = read("docs/product/TICKET_CHAT_DISPLAY_ACCEPT.md");
    assert.match(spec, /\*\*Status:\*\* ACCEPT/);
    assert.match(spec, /Contact strip/);
    assert.match(spec, /#383/);

    const dock = read("dashboard/src/components/InboxTicketActionDock.tsx");
    assert.match(dock, /data-ticket-action-dock/);
    assert.match(dock, /label="Done"/);
    assert.match(dock, /label="Call"/);
    assert.match(dock, /label="WhatsApp"/);
    assert.match(dock, /deskHitClass/);
    assert.match(read("dashboard/src/components/InboxPingTeammate.tsx"), /Ping teammate/);

    const strip = read("dashboard/src/components/ContactStrip.tsx");
    assert.match(strip, /data-contact-strip=/);
    assert.match(strip, /contactListSubline/);
    assert.doesNotMatch(strip, /CallLink|WhatsAppLink/);
    assert.doesNotMatch(strip, /CallTranscript/);
  });

  it("renders one conversation stream without per-bubble speaker stamps or system pills", () => {
    const src = read("dashboard/src/components/CallTranscript.tsx");
    const faq = read("dashboard/src/components/CallFaqSuggestions.tsx");
    const ticket = read("dashboard/src/components/InboxTicketView.tsx");
    const detail = read("docs/frontend/design-system/pages/call-detail.md");
    assert.match(src, /buildCallTranscriptStream/);
    assert.match(src, /data-transcript-stream/);
    assert.match(src, /aria-label=\{who\}/);
    assert.doesNotMatch(src, /uppercase tracking-wide/);
    assert.doesNotMatch(src, /rounded-full bg-surface-muted/);
    assert.match(faq, /tone === "thread"/);
    assert.doesNotMatch(faq, /rounded-full bg-surface-muted\/80/);
    assert.match(ticket, /data-escalation-delivery/);
    assert.match(ticket, /<ContactStrip/);
    assert.match(ticket, /<InboxTicketActionDock/);
    assert.match(detail, /One vertical conversation stream/);
    assert.doesNotMatch(src, /[\u2014\u2013]/);
    assert.doesNotMatch(faq, /[\u2014\u2013]/);
  });
});
