"use strict";

// Ops wallet alerts: one "topped up" mail on re-arm, and the staging wallet
// read from prod Desk under the sautikit_low:staging prefix (default KES 300).

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { runOpsAlerts, alertKindEnabled } = require("../dashboard/src/lib/opsAlertsRun.ts");
const {
  walletSignals,
  walletThresholdKind,
  walletEmptyKind,
  walletThresholdsMinor,
  parseWalletThresholdsKes,
  isStagingWalletKind,
  rearmCeilingMinor,
  LEGACY_WALLET_KIND,
  STAGING_WALLET_PREFIX,
  DEFAULT_STAGING_WALLET_THRESHOLDS_KES,
} = require("../dashboard/src/lib/balanceAlerts.ts");
const { kindLabel, opsMailSubject, isAckableOpsKind } = require("../dashboard/src/lib/platformOpsModel.ts");

const PROD = walletThresholdsMinor("500,100", 50_000); // [50000, 10000], as prod is configured
const STAGING = parseWalletThresholdsKes("", DEFAULT_STAGING_WALLET_THRESHOLDS_KES); // [30000]
let clock = Date.parse("2026-10-21T16:00:00.000Z");

function memoryStore(seed = []) {
  const rows = seed.map((row) => ({ ...row }));
  return {
    rows,
    async readOpenNotices() {
      return rows.filter((r) => r.status === "open" || r.status === "acked").map((r) => ({ ...r }));
    },
    async insertOpen(kind, detail, nowIso, opts) {
      if (rows.some((r) => r.kind === kind && (r.status === "open" || r.status === "acked"))) return false;
      rows.push({ id: `n${rows.length + 1}`, kind, status: "open", detail, notified_at: opts?.silent ? nowIso : null, opened_at: nowIso });
      return true;
    },
    async updateDetail(id, detail) {
      const row = rows.find((r) => r.id === id);
      if (row) row.detail = detail;
    },
    async resolve(id) {
      const row = rows.find((r) => r.id === id && (r.status === "open" || r.status === "acked"));
      if (!row) return null;
      row.status = "resolved";
      return { ...row };
    },
    async claimNotified(id, nowIso) {
      const row = rows.find((r) => r.id === id && r.notified_at == null);
      if (!row) return false;
      row.notified_at = nowIso;
      return true;
    },
    async releaseClaim(id, iso) {
      const row = rows.find((r) => r.id === id && r.notified_at === iso);
      if (row) row.notified_at = null;
    },
  };
}

/** One cron pass over both wallets, with the real subject line and a body that is the detail. */
async function pass(store, { prod, staging }) {
  clock += 10 * 60 * 1000;
  const open = (await store.readOpenNotices()).map((r) => ({ kind: r.kind, status: r.status, notified_at: r.notified_at }));
  const mails = [];
  const result = await runOpsAlerts({
    store,
    signals: [
      ...walletSignals({ balanceMinor: prod, thresholdsMinor: PROD, openNotices: open }),
      ...walletSignals({ balanceMinor: staging, thresholdsMinor: STAGING, openNotices: open, kindPrefix: STAGING_WALLET_PREFIX }),
    ],
    kinds: {},
    recipients: ["ops@example.com"],
    dryRun: false,
    now: new Date(clock),
    staleMs: 6 * 60 * 60 * 1000,
    compose: (kind, recovered, detail) => ({ subject: opsMailSubject(kind, recovered), text: detail }),
    send: async (mail) => {
      mails.push(mail);
    },
  });
  return { result, mails };
}

describe("wallet top-up mail", () => {
  it("prod at KES 28: one low mail, then one topped-up mail only above KES 550", async () => {
    const store = memoryStore();
    const low = await pass(store, { prod: 2_827, staging: null });
    assert.equal(low.mails.length, 1);
    assert.equal(low.mails[0].kind, walletThresholdKind(10_000));
    assert.equal(low.mails[0].subject, "Scalers ops: Money");
    assert.match(low.mails[0].text, /KES 28\.27, below KES 100/);

    for (const balance of [2_827, 2_827]) {
      const quiet = await pass(store, { prod: balance, staging: null });
      assert.equal(quiet.mails.length, 0);
    }
    // KES 300: the KES 100 notice re-arms quietly; still below KES 500, so no top-up mail yet.
    const partial = await pass(store, { prod: 30_000, staging: null });
    assert.deepEqual(partial.result.resolved, [walletThresholdKind(10_000)]);
    assert.equal(partial.mails.length, 0);
    // KES 520 and KES 550: above 500 but inside the 10 percent hold.
    for (const balance of [52_000, 55_000]) {
      const hold = await pass(store, { prod: balance, staging: null });
      assert.equal(hold.mails.length, 0);
      assert.deepEqual(hold.result.resolved, []);
    }
    const topped = await pass(store, { prod: 60_000, staging: null });
    assert.equal(topped.mails.length, 1);
    assert.equal(topped.mails[0].kind, walletThresholdKind(50_000));
    assert.equal(topped.mails[0].subject, "Scalers ops: Money topped up");
    assert.equal(topped.mails[0].text, "Phone wallet topped up: KES 600, back above KES 550");
    assert.match(topped.mails[0].ledgerKey, /^ops:cron:.+:recovered$/);

    const after = await pass(store, { prod: 60_000, staging: null });
    assert.equal(after.mails.length, 0);
  });

  it("one big top-up from below KES 100 sends one mail, not one per threshold", async () => {
    const store = memoryStore();
    await pass(store, { prod: 1_500, staging: null });
    const topped = await pass(store, { prod: 200_000, staging: null });
    assert.deepEqual(topped.result.resolved.sort(), [walletThresholdKind(10_000), walletThresholdKind(50_000)].sort());
    assert.equal(topped.mails.length, 1);
    assert.equal(topped.mails[0].kind, walletThresholdKind(50_000));
  });

  it("an open legacy notice resolves quietly when a threshold notice carries the top-up", async () => {
    const store = memoryStore([
      { id: "legacy", kind: LEGACY_WALLET_KIND, status: "acked", detail: "", notified_at: "2026-10-18T09:46:16Z", opened_at: "2026-10-09T08:13:00Z" },
    ]);
    const low = await pass(store, { prod: 2_827, staging: null });
    assert.equal(low.mails.length, 1);
    const topped = await pass(store, { prod: 60_000, staging: null });
    assert.ok(topped.result.resolved.includes(LEGACY_WALLET_KIND));
    assert.equal(topped.mails.length, 1);
    assert.equal(topped.mails[0].kind, walletThresholdKind(50_000));
  });

  it("an empty wallet mails once, and the top-up mails once", async () => {
    const store = memoryStore();
    const empty = await pass(store, { prod: -27_314, staging: null });
    assert.deepEqual(empty.mails.map((m) => m.kind), [walletEmptyKind()]);
    const topped = await pass(store, { prod: 70_000, staging: null });
    assert.deepEqual(topped.mails.map((m) => m.kind), [walletThresholdKind(50_000)]);
  });

  it("an unreadable balance neither resolves nor mails", async () => {
    const store = memoryStore();
    await pass(store, { prod: 2_827, staging: 20_000 });
    const unknown = await pass(store, { prod: null, staging: null });
    assert.deepEqual(unknown.result.resolved, []);
    assert.equal(unknown.mails.length, 0);
  });
});

describe("staging wallet from prod Desk", () => {
  it("defaults to KES 300 and uses its own kinds under the Money toggle", () => {
    assert.deepEqual(STAGING, [30_000]);
    assert.equal(rearmCeilingMinor(50_000, 0.1), 55_000);
    assert.equal(rearmCeilingMinor(30_000, 0.1), 33_000);
    assert.deepEqual(parseWalletThresholdsKes("250", DEFAULT_STAGING_WALLET_THRESHOLDS_KES), [25_000]);
    const kind = walletThresholdKind(30_000, STAGING_WALLET_PREFIX);
    assert.equal(kind, "sautikit_low:staging:30000");
    assert.equal(isStagingWalletKind(kind), true);
    assert.equal(isStagingWalletKind(walletThresholdKind(30_000)), false);
    assert.equal(kindLabel(kind), "Staging money");
    assert.equal(kindLabel(walletThresholdKind(50_000)), "Money");
    assert.equal(opsMailSubject(kind, true), "Scalers ops: Staging money topped up");
    assert.equal(opsMailSubject("speech", true), "Scalers ops: Speech recovered");
    assert.equal(isAckableOpsKind(kind), true);
    assert.equal(alertKindEnabled(kind, { sautikit_low: false }), false);
  });

  it("alerts once under KES 300, separately from prod, and tops up once above KES 330", async () => {
    const store = memoryStore();
    const first = await pass(store, { prod: 100_000, staging: 25_000 });
    assert.equal(first.mails.length, 1);
    assert.equal(first.mails[0].kind, "sautikit_low:staging:30000");
    assert.equal(first.mails[0].subject, "Scalers ops: Staging money");
    assert.equal(first.mails[0].text, "Staging phone wallet: KES 250, below KES 300");

    const prodDrops = await pass(store, { prod: 2_827, staging: 25_000 });
    assert.deepEqual(prodDrops.mails.map((m) => m.kind), [walletThresholdKind(10_000)]);

    const hover = await pass(store, { prod: 2_827, staging: 32_000 });
    assert.equal(hover.mails.length, 0);
    const topped = await pass(store, { prod: 2_827, staging: 40_000 });
    assert.deepEqual(topped.mails.map((m) => [m.kind, m.subject, m.text]), [
      ["sautikit_low:staging:30000", "Scalers ops: Staging money topped up", "Staging phone wallet topped up: KES 400, back above KES 330"],
    ]);
    // Prod's notices are untouched by the staging top-up.
    assert.equal(store.rows.filter((r) => r.status === "open" && !isStagingWalletKind(r.kind)).length, 2);
  });

  it("staging key unset: staging kinds hold and nothing opens", async () => {
    const signals = walletSignals({ balanceMinor: null, thresholdsMinor: STAGING, openNotices: [], kindPrefix: STAGING_WALLET_PREFIX });
    assert.ok(signals.every((s) => s.hold));
    assert.ok(!signals.some((s) => s.kind === LEGACY_WALLET_KIND));
  });

  it("reads the staging wallet with its own key name, and staging Desk still never mails", () => {
    const ops = fs.readFileSync("dashboard/src/lib/opsAlerts.ts", "utf8");
    assert.match(ops, /process\.env\.SAUTIKIT_STAGING_WALLET_KEY/);
    assert.match(ops, /OPS_STAGING_WALLET_ALERT_THRESHOLDS_KES/);
    assert.match(ops, /kindPrefix: STAGING_WALLET_PREFIX/);
    assert.match(ops, /if \(staging\) throw new Error\("staging"\)/);
    const sautikit = fs.readFileSync("dashboard/src/lib/sautikit.ts", "utf8");
    assert.match(sautikit, /getSautikitWallet\(apiKey\?: string\)/);
  });
});
