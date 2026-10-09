"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const run = require("../dashboard/src/lib/opsAlertsRun.ts");

const SECRET = "s3cret-for-tests-only-0123456789";

/** In-memory platform_ops_notices with the same conditional writes as the Supabase store. */
function memoryStore(seed = []) {
  const rows = seed.map((r) => ({ ...r }));
  let n = rows.length;
  const live = (r) => r.status === "open" || r.status === "acked";
  return {
    rows,
    async readOpenNotices() {
      return rows.filter(live).map((r) => ({ ...r }));
    },
    async insertOpen(kind, detail, nowIso) {
      if (rows.some((r) => r.kind === kind && live(r))) return false; // one open per kind
      rows.push({ id: `n${++n}`, kind, status: "open", detail, opened_at: nowIso, notified_at: null });
      return true;
    },
    async updateDetail(id, detail) {
      const row = rows.find((r) => r.id === id);
      if (row) row.detail = detail;
    },
    async resolve(id, nowIso) {
      const row = rows.find((r) => r.id === id && live(r));
      if (!row) return null;
      row.status = "resolved";
      row.resolved_at = nowIso;
      return { ...row };
    },
    async claimNotified(id, nowIso) {
      const row = rows.find((r) => r.id === id && r.notified_at === null);
      if (!row) return false;
      row.notified_at = nowIso;
      return true;
    },
    async releaseClaim(id, claimedIso) {
      const row = rows.find((r) => r.id === id && r.notified_at === claimedIso);
      if (row) row.notified_at = null;
    },
  };
}

function harness({ store = memoryStore(), signals, dryRun = false, recipients = ["ops@scalers.co.ke"], kinds = {}, failSend = false }) {
  const sent = [];
  const go = (now = new Date("2026-10-09T10:00:00.000Z")) =>
    run.runOpsAlerts({
      store,
      signals,
      kinds,
      recipients,
      dryRun,
      now,
      compose: (kind, recovered, detail) => ({ subject: `${kind}${recovered ? " recovered" : ""}`, text: detail }),
      send: async (mail) => {
        if (failSend) throw new Error("down");
        sent.push(mail);
      },
    });
  return { store, sent, go };
}

const speechDown = [{ kind: "speech", active: true, detail: "Speech not responding" }];
const speechUp = [{ kind: "speech", active: false, detail: "" }];

describe("ops alerts cron: auth", () => {
  it("refuses a missing, wrong, or unconfigured secret", () => {
    assert.equal(run.cronAuthorized(null, SECRET), false);
    assert.equal(run.cronAuthorized("", SECRET), false);
    assert.equal(run.cronAuthorized(`Bearer ${SECRET}x`, SECRET), false);
    assert.equal(run.cronAuthorized(SECRET, SECRET), false);
    assert.equal(run.cronAuthorized(`bearer ${SECRET}`, SECRET), false);
    assert.equal(run.cronAuthorized("Bearer ", ""), false);
    assert.equal(run.cronAuthorized("Bearer undefined", undefined), false);
    assert.equal(run.cronAuthorized("Bearer short", "short"), false, "a weak secret is treated as unset");
    assert.equal(run.cronAuthorized(`Bearer ${SECRET}`, SECRET), true);
  });

  it("checks the header before doing any work and answers 401", () => {
    const route = read("dashboard/src/app/api/cron/ops-alerts/route.ts");
    const body = route.slice(route.indexOf("export async function GET"));
    const authAt = body.indexOf("cronAuthorized(request.headers.get(\"authorization\"), process.env.CRON_SECRET)");
    assert.ok(authAt > 0);
    assert.ok(authAt < body.indexOf("runScheduledOpsAlerts"));
    assert.match(body, /status: 401/);
    assert.doesNotMatch(route, /export async function (POST|PUT|PATCH|DELETE)/);
    assert.doesNotMatch(route, /CRON_SECRET\}/, "never echoes the secret");
  });

  it("is scheduled every 10 minutes in dashboard/vercel.json", () => {
    const config = JSON.parse(read("dashboard/vercel.json"));
    assert.deepEqual(config.crons, [{ path: "/api/cron/ops-alerts", schedule: "*/10 * * * *" }]);
    assert.equal(config.ignoreCommand, "bash scripts/vercel-ignore-build.sh");
  });
});

describe("ops alerts cron: idempotent", () => {
  it("mails a notice once across repeated runs, and its recovery once", async () => {
    const h = harness({ signals: speechDown });
    const first = await h.go();
    assert.deepEqual(first.opened, ["speech"]);
    assert.equal(h.sent.length, 1);
    await h.go(new Date("2026-10-09T10:10:00.000Z"));
    await h.go(new Date("2026-10-09T12:00:00.000Z"));
    assert.equal(h.sent.length, 1, "no repeat mail while it stays down");

    const recovered = harness({ store: h.store, signals: speechUp });
    await recovered.go();
    await recovered.go();
    assert.equal(recovered.sent.length, 1);
    assert.equal(recovered.sent[0].subject, "speech recovered");
    assert.equal(h.store.rows.filter((r) => r.status === "resolved").length, 1);
  });

  it("does not double-send when two runs race on the same notice", async () => {
    const store = memoryStore();
    const a = harness({ store, signals: speechDown });
    const b = harness({ store, signals: speechDown });
    await Promise.all([a.go(), b.go()]);
    assert.equal(a.sent.length + b.sent.length, 1);
    assert.equal(store.rows.length, 1, "one open notice per kind");
  });

  it("never re-mails a notice the old page-load check already mailed", async () => {
    const store = memoryStore([{ id: "old", kind: "speech", status: "open", notified_at: "2026-10-09T08:00:00.000Z" }]);
    const h = harness({ store, signals: speechDown });
    await h.go();
    assert.equal(h.sent.length, 0);
  });

  it("releases the claim when a send fails, so the next run sends it once", async () => {
    const store = memoryStore();
    const broken = harness({ store, signals: speechDown, failSend: true });
    const r = await broken.go();
    assert.deepEqual(r.failed, ["speech"]);
    assert.equal(store.rows[0].notified_at, null);
    const ok = harness({ store, signals: speechDown });
    await ok.go();
    await ok.go();
    assert.equal(ok.sent.length, 1);
  });

  it("skips acked notices and disabled kinds", async () => {
    const store = memoryStore([{ id: "a", kind: "speech", status: "acked", notified_at: null }]);
    const h = harness({ store, signals: [...speechDown, { kind: "pool_empty", active: true, detail: "No numbers" }], kinds: { pool_empty: false } });
    await h.go();
    assert.equal(h.sent.length, 0);
    assert.ok(!store.rows.some((r) => r.kind === "pool_empty"));
  });

  it("sends no recovery for an alert nobody received", async () => {
    const store = memoryStore([{ id: "q", kind: "speech", status: "open", notified_at: null }]);
    const h = harness({ store, signals: speechUp });
    const r = await h.go();
    assert.deepEqual(r.resolved, ["speech"]);
    assert.equal(h.sent.length, 0);
  });
});

describe("ops alerts cron: dry run", () => {
  it("defaults to dry run unless the flag is explicitly off", () => {
    for (const v of [undefined, null, "", "true", "1", "yes", "TRUE", "anything"]) assert.equal(run.opsAlertsDryRun(v), true, String(v));
    for (const v of ["false", "FALSE", "0", "off", "no", " false "]) assert.equal(run.opsAlertsDryRun(v), false, v);
  });

  it("opens and resolves notices but sends and claims nothing", async () => {
    const h = harness({ signals: speechDown, dryRun: true });
    const r = await h.go();
    assert.equal(r.dryRun, true);
    assert.deepEqual(r.opened, ["speech"]);
    assert.deepEqual(r.wouldSend, [{ kind: "speech", recovered: false }]);
    assert.equal(h.sent.length, 0);
    assert.equal(h.store.rows[0].notified_at, null, "first live run still sends it once");
    const live = harness({ store: h.store, signals: speechDown });
    await live.go();
    await live.go();
    assert.equal(live.sent.length, 1);
  });

  it("reads OPS_ALERTS_DRY_RUN and treats missing mail config as dry run", () => {
    const src = read("dashboard/src/lib/opsAlerts.ts");
    assert.match(src, /opsAlertsDryRun\(process\.env\.OPS_ALERTS_DRY_RUN\) \|\| !isOpsMailConfigured\(\)/);
  });
});

describe("ops alerts cron: Admin recipients only", () => {
  it("takes people emails, else the emails list, from the settings row and never the environment", () => {
    assert.deepEqual(
      run.alertRecipients({
        people: [{ name: "Alvin", email: "Alvin@Scalers.co.ke" }, { name: "No mail", phone: "+254700000000" }],
        emails: ["ops@scalers.co.ke"],
      }),
      ["alvin@scalers.co.ke"],
    );
    assert.deepEqual(
      run.alertRecipients({ people: [{ name: "No mail", phone: "+254700000000" }], emails: ["Ops@scalers.co.ke", "ops@scalers.co.ke", "nope"] }),
      ["ops@scalers.co.ke"],
    );
    assert.deepEqual(run.alertRecipients(null), []);
    assert.deepEqual(run.alertRecipients({ emails: [], people: [] }), []);
    const server = read("dashboard/src/lib/opsAlerts.ts");
    const pure = read("dashboard/src/lib/opsAlertsRun.ts");
    assert.doesNotMatch(server, /SCALERS_OPS_ALERT_EMAIL|envEmails|loadOpsSettings/);
    assert.doesNotMatch(pure, /process\.env/);
    assert.match(server, /from\("platform_ops_settings"\)\.select\("emails, people, kinds"\)/);
  });

  it("sends to exactly the Admin list, and to nobody when it is empty", async () => {
    const h = harness({ signals: speechDown, recipients: ["a@scalers.co.ke", "b@scalers.co.ke"] });
    await h.go();
    assert.deepEqual(h.sent[0].to, ["a@scalers.co.ke", "b@scalers.co.ke"]);

    const empty = harness({ signals: speechDown, recipients: [] });
    const r = await empty.go();
    assert.equal(empty.sent.length, 0);
    assert.deepEqual(r.opened, ["speech"]);
    assert.equal(empty.store.rows[0].notified_at, null, "an alert nobody got stays unsent");
  });
});

describe("ops alerts: no Admin page sends", () => {
  it("Platform and Today only read", () => {
    const platform = read("dashboard/src/app/admin/(console)/platform/page.tsx");
    const ops = read("dashboard/src/lib/platformOps.ts");
    assert.match(platform, /readPlatformOps\(\)/);
    assert.doesNotMatch(platform, /runScheduledOpsAlerts|evaluatePlatformOps|sendOpsMail/);
    assert.doesNotMatch(ops, /sendOpsMail|\.insert\(/);
    assert.doesNotMatch(read("dashboard/src/app/admin/(console)/page.tsx"), /runScheduledOpsAlerts|sendOpsMail/);
  });
});
