/**
 * M1 / L5 from the billing stack review. The notice idempotency key is the
 * notify ledger key, and a replay that already shows a send settles sent.
 */
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { sendClaimedBillingNotices } = require("../src/billing/billingNoticeSend");

const notice = {
  id: "notice-1",
  channel: "email",
  recipient: "owner@example.com",
  body: "Invoice SCL-2026-000042 is due.",
  title: "Invoice",
  kind: "platform_billing_invoice_issued",
  tenant_id: "t1",
  idempotency_key: "platform_billing_invoice_issued:inv1",
};

describe("billing notice sends", () => {
  it("passes the notice idempotency key as the notify ledger key", async () => {
    let seen = null;
    await sendClaimedBillingNotices({
      env: { BILLING_NOTICES_SEND: "on" },
      claim: async () => [notice],
      settle: async () => {},
      dispatch: async (input) => {
        seen = input;
        return { channel: "email", notifySendId: "send-1" };
      },
    });
    assert.equal(seen.ledger.keyBase, "platform_billing_invoice_issued:inv1");
  });

  it("does nothing unless BILLING_NOTICES_SEND=on", async () => {
    let claimed = false;
    const off = await sendClaimedBillingNotices({
      env: {},
      claim: async () => {
        claimed = true;
        return [notice];
      },
      settle: async () => {},
      dispatch: async () => ({ channel: "email" }),
    });
    assert.equal(off.skipped, true);
    assert.equal(claimed, false);
  });

  it("settles sent when the notify ledger already shows the send", async () => {
    const settled = [];
    const result = await sendClaimedBillingNotices({
      env: { BILLING_NOTICES_SEND: "on" },
      claim: async () => [notice],
      settle: async (id, status) => {
        settled.push({ id, status });
      },
      dispatch: async () => ({ channel: null, reason: "instance_already_sent" }),
    });
    assert.equal(result.sent, 1);
    assert.deepEqual(settled, [{ id: "notice-1", status: "sent" }]);
  });

  it("settles failed when the send did not land and the ledger has no send", async () => {
    const settled = [];
    const result = await sendClaimedBillingNotices({
      env: { BILLING_NOTICES_SEND: "on" },
      claim: async () => [notice],
      settle: async (id, status) => {
        settled.push({ id, status });
      },
      dispatch: async () => ({ channel: null, reason: "send_failed" }),
    });
    assert.equal(result.sent, 0);
    assert.deepEqual(settled, [{ id: "notice-1", status: "failed" }]);
  });
});
