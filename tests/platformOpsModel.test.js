"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ROOT = path.join(__dirname, "..");
const modelPath = path.join(ROOT, "dashboard/src/lib/platformOpsModel.ts");

function run(script) {
  const ran = spawnSync(
    process.execPath,
    ["--experimental-strip-types", "--input-type=module", "-e", script],
    { encoding: "utf8" }
  );
  assert.equal(ran.status, 0, ran.stderr || ran.stdout);
  return JSON.parse(ran.stdout.trim().split("\n").at(-1));
}

function evalModel(body) {
  return run(`
    import * as m from ${JSON.stringify(modelPath)};
    ${body}
  `);
}

describe("platform ops model", () => {
  it("marks pool empty only when someone is waiting", () => {
    const got = evalModel(`
      const emptyWaiting = m.deriveOpsSignals({
        speech: { tone: "ok", detail: null },
        reasoning: { tone: "ok", detail: null },
        phoneLine: { tone: "ok", detail: null },
        walletMinor: 80000,
        sautikitWarnMinor: 50000,
        availableDids: 0,
        waitingBusinesses: 1,
        expiredBetaCount: 0,
      });
      const emptyIdle = m.deriveOpsSignals({
        speech: { tone: "ok", detail: null },
        reasoning: { tone: "ok", detail: null },
        phoneLine: { tone: "ok", detail: null },
        walletMinor: 80000,
        sautikitWarnMinor: 50000,
        availableDids: 0,
        waitingBusinesses: 0,
        expiredBetaCount: 0,
      });
      console.log(JSON.stringify({
        waiting: emptyWaiting.find((s) => s.kind === "pool_empty"),
        idle: emptyIdle.find((s) => s.kind === "pool_empty"),
      }));
    `);
    assert.equal(got.waiting.active, true);
    assert.equal(got.waiting.critical, true);
    assert.equal(got.idle.active, false);
  });

  it("treats an empty phone wallet as critical and a warn-level wallet as a notice", () => {
    const got = evalModel(`
      const warn = m.deriveOpsSignals({
        speech: { tone: "ok", detail: null },
        reasoning: { tone: "ok", detail: null },
        phoneLine: { tone: "ok", detail: null },
        walletMinor: 20000,
        sautikitWarnMinor: 50000,
        availableDids: 2,
        waitingBusinesses: 0,
        expiredBetaCount: 0,
      });
      const empty = m.deriveOpsSignals({
        speech: { tone: "ok", detail: null },
        reasoning: { tone: "ok", detail: null },
        phoneLine: { tone: "ok", detail: null },
        walletMinor: 0,
        sautikitWarnMinor: 50000,
        availableDids: 2,
        waitingBusinesses: 0,
        expiredBetaCount: 0,
      });
      console.log(JSON.stringify({
        warn: warn.find((s) => s.kind === "sautikit_low"),
        empty: empty.find((s) => s.kind === "sautikit_low"),
        stripWarn: m.deriveStatusStrip(warn),
        stripEmpty: m.deriveStatusStrip(empty),
        stripOk: m.deriveStatusStrip(warn.map((s) => s.kind === "sautikit_low" ? { ...s, active: false } : s)),
      }));
    `);
    assert.equal(got.warn.active, true);
    assert.equal(got.warn.critical, false);
    assert.equal(got.empty.critical, true);
    assert.equal(got.stripWarn.tone, "attention");
    assert.equal(got.stripEmpty.tone, "down");
    assert.equal(got.stripOk.tone, "ok");
    assert.equal(got.stripOk.label, "Platform OK");
  });

  it("opens and notifies once, then resolves when the signal clears", () => {
    const got = evalModel(`
      const kinds = m.defaultKindFlags();
      const first = m.reconcileNotices([], [{
        kind: "pool_empty", active: true, critical: true, title: "Number pool empty", detail: "1 waiting",
      }], kinds, 1_000);
      const second = m.reconcileNotices([{
        id: "n1", kind: "pool_empty", status: "open", detail: "1 waiting", notified_at: new Date(1_000).toISOString(),
      }], [{
        kind: "pool_empty", active: true, critical: true, title: "Number pool empty", detail: "1 waiting",
      }], kinds, 2_000);
      const later = m.reconcileNotices([{
        id: "n1", kind: "pool_empty", status: "open", detail: "1 waiting", notified_at: new Date(1_000).toISOString(),
      }], [{
        kind: "pool_empty", active: true, critical: true, title: "Number pool empty", detail: "1 waiting",
      }], kinds, 1_000 + m.OPS_MAIL_COOLDOWN_MS);
      const cleared = m.reconcileNotices([{
        id: "n1", kind: "pool_empty", status: "open", detail: "1 waiting", notified_at: new Date(1_000).toISOString(),
      }], [{
        kind: "pool_empty", active: false, critical: false, title: "Number pool empty", detail: "",
      }], kinds, 3_000);
      console.log(JSON.stringify({ first, second, later, cleared }));
    `);
    assert.deepEqual(got.first.open, ["pool_empty"]);
    assert.deepEqual(got.first.notify, ["pool_empty"]);
    assert.deepEqual(got.second.open, []);
    assert.deepEqual(got.second.notify, []);
    assert.deepEqual(got.later.notify, ["pool_empty"]);
    assert.deepEqual(got.cleared.resolve, ["pool_empty"]);
  });

  it("parses staff emails and keeps owner notices off the ops queue mix", () => {
    const got = evalModel(`
      console.log(JSON.stringify({
        emails: m.parseOpsEmails("Ops@Scalers.co.ke, bad, ops@scalers.co.ke; mercy@scalers.co.ke"),
        subject: m.opsMailSubject("beta_expired"),
        recovered: m.opsMailSubject("speech", true),
        domain: m.OPS_RESEND_DOMAIN,
        people: m.parsePeople([
          { name: "Mercy", phone: "+254700000001", email: "mercy@scalers.co.ke" },
          { name: "", phone: "", email: "bad" },
        ], ["ops@scalers.co.ke"]),
        queue: m.mergeQueueRows({
          notices: [
            { kind: "pool_empty", detail: "1 business waiting. No numbers available.", status: "open" },
            { kind: "speech", detail: "ok", status: "acked" },
          ],
          businesses: [{ id: "b1", name: "Waiting Co", status: "waiting" }],
        }),
      }));
    `);
    assert.deepEqual(got.emails, ["ops@scalers.co.ke", "mercy@scalers.co.ke"]);
    assert.equal(got.domain, "ops.scalers.co.ke");
    assert.equal(got.recovered, "Scalers ops: Speech recovered");
    assert.equal(got.people.length, 1);
    assert.equal(got.people[0].name, "Mercy");
    assert.equal(got.people[0].phone, "+254700000001");
    assert.equal(got.subject, "Scalers ops: Beta ended");
    assert.equal(got.queue[0].href, "/admin/platform#escalate");
    assert.equal(got.queue[0].stamp, "Open");
    assert.equal(got.queue[1].href, "/admin/businesses#biz-b1");
    assert.equal(got.queue[1].stamp, "Waiting");
  });
});
