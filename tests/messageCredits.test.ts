/**
 * One message-credit allowance per plan: texts, WhatsApp and email share it.
 * Run: node --experimental-strip-types --no-warnings --test tests/messageCredits.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { creditBurnsFrom, messageCreditsUsage } from "../dashboard/src/lib/messageCredits.ts";
import { ownerBillingView } from "../dashboard/src/lib/billingStateModel.ts";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel: string) => fs.readFileSync(path.join(root, rel), "utf8");
const burns = { sms: 1, whatsapp: 2, email: 1 };

describe("message credits", () => {
  it("counts texts, WhatsApp and email against one allowance", () => {
    assert.deepEqual(messageCreditsUsage(2500, burns, { sms: 420, whatsapp: 118, email: 64 }), {
      included: 2500,
      used: 720,
      left: 1780,
    });
  });

  it("never goes below zero left", () => {
    assert.deepEqual(messageCreditsUsage(100, burns, { sms: 90, whatsapp: 10, email: 5 }), {
      included: 100,
      used: 115,
      left: 0,
    });
  });

  it("hides without message_credits, without burns, or with a zero allowance", () => {
    const use = { sms: 5, whatsapp: 1, email: 1 };
    assert.equal(messageCreditsUsage(null, burns, use), null);
    assert.equal(messageCreditsUsage(1000, null, use), null);
    assert.equal(messageCreditsUsage(0, burns, use), null);
  });

  it("reads burns only when all three are on the version", () => {
    assert.deepEqual(
      creditBurnsFrom({ sms_credit_burn: "1", whatsapp_credit_burn: 2, email_credit_burn: 1 }),
      burns,
    );
    assert.equal(creditBurnsFrom({ sms_credit_burn: 1, whatsapp_credit_burn: 2 }), null);
    assert.equal(creditBurnsFrom({}), null);
  });

  it("keeps per-channel counts off the Usage rows", () => {
    const view = ownerBillingView({
      state: { package_state: "active", package_name: "Starter", sms_included: 50, sms_used: 18, mode_label: "beta" },
      monthlyPriceKes: null,
      smsMessages: null,
      seatsIncluded: 3,
      seatsUsed: 1,
      messagesSent: { email: 9, whatsapp: 14 },
    });
    assert.deepEqual(
      view.rows.map((row) => row.key),
      ["minutes", "sms", "seats"],
    );
    assert.deepEqual(view.messageUse, { sms: 18, whatsapp: 14, email: 9 });
  });

  it("shows one Message credits row with the shared line and no separate alerts", () => {
    const summary = read("dashboard/src/components/plan/UsageSummary.tsx");
    const wallet = read("dashboard/src/app/(desk)/wallet/page.tsx");
    const fixture = read("dashboard/src/app/dev/billing/BillingFixture.tsx");
    assert.match(summary, /Texts, WhatsApp and email to you, your team and callers all use message credits\./);
    assert.match(summary, /\{credits \? \(/);
    assert.match(wallet, /messageCreditsUsage\(extras\.messageCredits, extras\.creditBurns, view\.messageUse\)/);
    for (const [rel, text] of [
      ["UsageSummary", summary],
      ["wallet", wallet],
      ["BillingFixture", fixture],
      ["billingStateModel", read("dashboard/src/lib/billingStateModel.ts")],
      ["BetaPlanSummary", read("dashboard/src/components/plan/BetaPlanSummary.tsx")],
    ]) {
      assert.doesNotMatch(text, /Team (email|WhatsApp) alerts/, rel);
      assert.doesNotMatch(text, /own allowance/, rel);
      assert.doesNotMatch(text, /_credit_burn|burns\.(sms|whatsapp|email)\}/, rel);
    }
  });

  it("beta Plan reads the same shared total, not the text-only bucket", () => {
    const beta = read("dashboard/src/components/plan/BetaPlanSummary.tsx");
    const plan = read("dashboard/src/app/(desk)/settings/plan/page.tsx");
    assert.doesNotMatch(beta, /sms: "Message credits"/);
    assert.match(plan, /betaPlanRows\(view, credits\)/);
  });
});
