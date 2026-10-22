// Wallet alert mail in the @scalers/email layout, tagged by the wallet it is
// about: [PRODUCTION] for the live workspace, [STAGING] for the test one, even
// though prod Desk sends both. Run with --import ./tests/registerTs.mjs.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { walletMail, eatLabel, nextRenewalLabel, renewalRiskLine } from "../dashboard/src/lib/opsWalletEmail.ts";
import { OPS_WALLET_FIELDS, OPS_WALLET_TEMPLATES } from "../dashboard/src/lib/opsWalletTemplates.ts";
import { runOpsAlerts } from "../dashboard/src/lib/opsAlertsRun.ts";
import {
  walletSignals,
  walletThresholdKind,
  walletEmptyKind,
  walletThresholdsMinor,
  parseWalletThresholdsKes,
  LEGACY_WALLET_KIND,
  STAGING_WALLET_PREFIX,
  DEFAULT_STAGING_WALLET_THRESHOLDS_KES,
} from "../dashboard/src/lib/balanceAlerts.ts";

const PROD = walletThresholdsMinor("500,100", 50_000);
const STAGING = parseWalletThresholdsKes("", DEFAULT_STAGING_WALLET_THRESHOLDS_KES);
const AT = new Date("2026-10-21T15:49:24.000Z"); // 18:49 EAT

function ctx(prodMinor, stagingMinor, renewal = { count: 2, dueMinor: 20_000, date: "1 Nov" }) {
  return {
    production: { balanceMinor: prodMinor, workspaceId: "e0e57aa5-0000-4000-8000-000000000000", thresholdsMinor: PROD, renewal },
    staging: { balanceMinor: stagingMinor, workspaceId: "1f85601c-0000-4000-8000-000000000000", thresholdsMinor: STAGING },
    checkedAt: AT,
    rearmMargin: 0.1,
  };
}

const visible = (html) => html.replace(/<style[\s\S]*?<\/style>/gi, "");

describe("ops wallet mail", () => {
  it("production low: tagged, red band, facts, renewal risk, SautiKit top-up", () => {
    const m = walletMail(walletThresholdKind(10_000), false, ctx(2_827, 50_000));
    assert.equal(m.env, "production");
    assert.equal(m.state, "low");
    assert.match(m.subject, /^\[PRODUCTION\] /);
    assert.ok(m.subject.includes("KES 28.27") && m.subject.includes("KES 100"), m.subject);
    assert.match(m.html, /class="band-prod"/);
    for (const s of ["Production (e0e57aa5)", "KES 28.27", "KES 100", "21 Oct 2026, 18:49 EAT", "2 numbers renew on 1 Nov: KES 200 due."]) {
      assert.ok(m.text.includes(s), `text has ${s}`);
      assert.ok(m.html.includes(s), `html has ${s}`);
    }
    assert.match(m.html, /href="https:\/\/app\.sautikit\.com\/wallet"/);
    for (const token of Object.values(OPS_WALLET_FIELDS)) {
      assert.ok(!m.html.includes(token) && !m.text.includes(token) && !m.subject.includes(token), token);
    }
  });

  it("staging low never says PRODUCTION", () => {
    const m = walletMail(walletThresholdKind(30_000, STAGING_WALLET_PREFIX), false, ctx(50_000, 4_508));
    assert.equal(m.env, "staging");
    assert.match(m.subject, /^\[STAGING\] /);
    assert.match(m.html, /class="band-neu"/);
    assert.doesNotMatch(`${m.subject}\n${m.text}\n${visible(m.html)}`, /PRODUCTION/);
    assert.ok(m.text.includes("Staging (1f85601c)"));
    assert.ok(!m.text.includes("renew"), "no prod renewal line on staging");
  });

  it("every staging template is free of PRODUCTION; every production one leads with it", () => {
    for (const [key, t] of Object.entries(OPS_WALLET_TEMPLATES)) {
      if (key.startsWith("staging:")) {
        assert.ok(t.subject.startsWith("[STAGING] "), key);
        assert.doesNotMatch(`${t.subject}\n${t.text}\n${visible(t.html)}`, /PRODUCTION/, key);
      } else {
        assert.ok(t.subject.startsWith("[PRODUCTION] "), key);
      }
    }
  });

  it("topped up, empty and the legacy kind map to the same layout", () => {
    const up = walletMail(walletThresholdKind(50_000), true, ctx(60_000, 50_000));
    assert.equal(up.state, "topped_up");
    assert.match(up.subject, /^\[PRODUCTION\] .*topped up: KES 600/);
    assert.ok(up.text.includes("KES 550"), "re-armed above the ceiling");
    const stagingUp = walletMail(walletThresholdKind(30_000, STAGING_WALLET_PREFIX), true, ctx(60_000, 40_000));
    assert.match(stagingUp.subject, /^\[STAGING\] /);
    const empty = walletMail(walletEmptyKind(), false, ctx(0, 50_000));
    assert.equal(empty.state, "empty");
    assert.match(empty.subject, /^\[PRODUCTION\] .*empty/);
    const legacy = walletMail(LEGACY_WALLET_KIND, true, ctx(60_000, 50_000));
    assert.match(legacy.subject, /^\[PRODUCTION\] /);
    assert.equal(walletMail("speech", false, ctx(1, 1)), null);
    assert.equal(walletMail(walletThresholdKind(10_000), false, ctx(null, 1)), null);
  });

  it("escapes filled values in html", () => {
    const c = ctx(2_827, 50_000);
    c.production.workspaceId = "<b>x</b>";
    const m = walletMail(walletThresholdKind(10_000), false, c);
    assert.ok(!m.html.includes("<b>x"));
  });

  it("renewal line falls back to the date; EAT labels", () => {
    assert.equal(renewalRiskLine({ count: null, dueMinor: null, date: "1 Nov" }), "Numbers renew on 1 Nov.");
    assert.equal(renewalRiskLine({ count: 1, dueMinor: 10_000, date: "1 Nov" }), "1 number renews on 1 Nov: KES 100 due.");
    assert.equal(nextRenewalLabel(new Date("2026-10-31T21:30:00Z")), "1 Dec"); // 00:30 EAT on 1 Nov
    assert.equal(nextRenewalLabel(AT), "1 Nov");
    assert.equal(eatLabel(AT), "21 Oct 2026, 18:49 EAT");
    const m = walletMail(walletThresholdKind(10_000), false, ctx(2_827, 50_000, null));
    assert.ok(m.text.includes("Numbers renew on 1 Nov."));
  });

  it("a cron pass with prod Desk sends one tagged mail per wallet, html included", async () => {
    const rows = [];
    const store = {
      async readOpenNotices() { return rows.filter((r) => r.status === "open").map((r) => ({ ...r })); },
      async insertOpen(kind, detail, nowIso) { rows.push({ id: `n${rows.length + 1}`, kind, status: "open", detail, notified_at: null, opened_at: nowIso }); return true; },
      async updateDetail() {},
      async resolve(id, nowIso) { const r = rows.find((x) => x.id === id); r.status = "resolved"; return { ...r, resolved_at: nowIso }; },
      async claimNotified(id, nowIso) { const r = rows.find((x) => x.id === id); if (r.notified_at) return false; r.notified_at = nowIso; return true; },
      async releaseClaim(id) { rows.find((x) => x.id === id).notified_at = null; },
    };
    const c = ctx(2_827, 4_508);
    const mails = [];
    await runOpsAlerts({
      store,
      signals: [
        ...walletSignals({ balanceMinor: 2_827, thresholdsMinor: PROD, openNotices: [], rearmMargin: 0.1 }),
        ...walletSignals({ balanceMinor: 4_508, thresholdsMinor: STAGING, openNotices: [], rearmMargin: 0.1, kindPrefix: STAGING_WALLET_PREFIX }),
      ],
      kinds: {},
      recipients: ["ops@example.com"],
      dryRun: false,
      now: AT,
      compose: (kind, recovered, detail) => {
        const m = walletMail(kind, recovered, c);
        return m ? { subject: m.subject, text: m.text, html: m.html } : { subject: kind, text: detail };
      },
      send: async (mail) => { mails.push(mail); },
    });
    const tags = mails.map((m) => m.subject.split(" ")[0]).sort();
    assert.ok(tags.includes("[PRODUCTION]") && tags.includes("[STAGING]"), tags.join(","));
    for (const m of mails) assert.ok(m.html && m.html.startsWith("<!DOCTYPE"), m.kind);
    for (const m of mails.filter((x) => x.kind.startsWith(STAGING_WALLET_PREFIX))) {
      assert.doesNotMatch(`${m.subject}\n${m.text}\n${visible(m.html)}`, /PRODUCTION/);
    }
  });
});
