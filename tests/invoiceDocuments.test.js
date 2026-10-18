const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  EXAMPLE_COMPANY,
  OWNER_SUPPLIED_DETAILS,
  invoiceModel,
  receiptModel,
  renderInvoiceHtml,
  renderReceiptHtml,
} = require("../dashboard/src/lib/invoicePay/documents");
const { renderInvoicePdf, renderReceiptPdf } = require("../dashboard/src/lib/invoicePay/pdf");
const { shapeBillingHistory } = require("../dashboard/src/lib/invoicePay/history");
const {
  issuedNotice,
  dueSoonNotice,
  overdueNotice,
  paymentReceivedNotice,
} = require("../src/billing/invoiceNotices");
const { sendClaimedBillingNotices } = require("../src/billing/billingNoticeSend");

const sampleInvoice = {
  number: "SCL-2026-000001",
  issuedAt: "2026-10-18T08:00:00Z",
  dueAt: "2026-10-25T08:00:00Z",
  periodStart: "2026-10-01T00:00:00Z",
  periodEnd: "2026-10-31T21:00:00Z",
  subtotalKes: "7000.00",
  creditsAppliedKes: "500.00",
  totalKes: "6500.00",
  amountPaidKes: "0",
};

const sampleLines = [
  { kind: "plan", description: "Business Assistant plan", quantity: "1", unitAmountKes: "5000.00", amountKes: "5000.00" },
  { kind: "extra_minutes", description: "Extra minutes", quantity: "100", unitAmountKes: "6.00", amountKes: "600.00" },
  { kind: "extra_seats", description: "Extra seats", quantity: "1", unitAmountKes: "800.00", amountKes: "800.00" },
  { kind: "message_credits", description: "Message credits", quantity: "50", unitAmountKes: "2.00", amountKes: "100.00" },
  { kind: "proration", description: "Proration", quantity: "1", unitAmountKes: "500.00", amountKes: "500.00" },
];

const sampleBillTo = {
  businessName: "example business",
  ownerName: "example owner",
  email: "example@example.com",
  phone: "example phone",
};

function sampleDocs() {
  const invoice = invoiceModel({
    invoice: sampleInvoice,
    lines: sampleLines,
    billTo: sampleBillTo,
    payUrl: "https://app.scalers.co.ke/pay/example-token",
  });
  const receipt = receiptModel({
    billTo: sampleBillTo,
    receipt: {
      number: "RCT-2026-000001",
      invoiceNumber: "SCL-2026-000001",
      reference: "example-bachs-ref",
      amountKes: "6500.00",
      method: "M-Pesa",
      paidAt: "2026-10-18T12:00:00Z",
    },
  });
  return { invoice, receipt };
}

describe("invoice documents", () => {
  it("shows the example company, the lines, and no VAT", () => {
    const { invoice, receipt } = sampleDocs();
    assert.equal(invoice.company.address, EXAMPLE_COMPANY.address);
    assert.match(invoice.company.kraPin, /^example/);
    assert.equal(invoice.total, "KSh 6,500");
    assert.equal(invoice.credits, "KSh 500");
    assert.equal(invoice.lines.length, 5);
    assert.match(invoice.payUrl, /\/pay\/example-token$/);
    const html = renderInvoiceHtml(invoice);
    const receiptHtml = renderReceiptHtml(receipt);
    assert.match(html, /Business Assistant/);
    assert.match(html, /Pay now/);
    assert.match(html, /KSh 7,000/);
    assert.match(html, /example KRA PIN/);
    assert.doesNotMatch(html, /VAT/);
    assert.doesNotMatch(receiptHtml, /VAT/);
    assert.match(receiptHtml, /PAID/);
    assert.match(receiptHtml, /example-bachs-ref/);
    assert.ok(OWNER_SUPPLIED_DETAILS.some((line) => /KRA PIN/.test(line)));
    const pdf = renderInvoicePdf(invoice);
    const receiptPdf = renderReceiptPdf(receipt);
    assert.equal(pdf.subarray(0, 5).toString(), "%PDF-");
    assert.match(pdf.toString("latin1"), /SCL-2026-000001/);
    assert.match(receiptPdf.toString("latin1"), /PAID/);
    assert.doesNotMatch(pdf.toString("latin1"), /VAT/);
  });

  it("lists invoices and receipts for the owner history API", () => {
    const history = shapeBillingHistory({
      invoices: [
        {
          id: "inv-1",
          invoice_number: "SCL-2026-000001",
          status: "open",
          subtotal_kes: "7000",
          credits_applied_kes: null,
          total_kes: "7000",
          amount_paid_kes: "0",
          tax_kes: null,
        },
      ],
      lines: [
        {
          invoice_id: "inv-1",
          kind: "plan",
          description: "Business Assistant plan",
          quantity: "1",
          unit_amount_kes: "7000",
          amount_kes: "7000",
        },
      ],
      receipts: [
        {
          id: "rct-1",
          invoice_id: "inv-1",
          receipt_number: "RCT-2026-000001",
          amount_kes: "7000",
          method: "M-Pesa",
          provider_ref: "chk_1",
          paid_at: "2026-10-18T12:00:00Z",
        },
      ],
    });
    assert.equal(history.invoices[0].total_due, "KSh 7,000");
    assert.equal(history.invoices[0].tax_kes, null);
    assert.equal(history.invoices[0].pay_link_path, "/api/billing/invoices/inv-1/pay-link");
    assert.equal(history.receipts[0].pdf_path, "/api/billing/receipts/rct-1/pdf");
    assert.equal(history.invoices[0].lines[0].description, "Business Assistant plan");
  });
});

describe("billing notice templates", () => {
  const invoice = { id: "inv-1", number: "SCL-2026-000001", totalKes: "7000" };

  it("uses Business Assistant and KSh, and does not send unless the flag is on", async () => {
    for (const notice of [
      issuedNotice(invoice),
      dueSoonNotice(invoice),
      overdueNotice(invoice),
      paymentReceivedNotice({ id: "rct-1", number: "RCT-2026-000001", amountKes: "7000", reference: "chk_1" }),
    ]) {
      assert.match(notice.body, /Business Assistant/);
      assert.match(notice.body, /KSh 7,000/);
      assert.doesNotMatch(notice.body, /VAT/);
      assert.match(notice.kind, /^platform_billing_/);
    }
    let called = false;
    const held = await sendClaimedBillingNotices({
      env: {},
      claim: async () => {
        called = true;
        return [];
      },
      settle: async () => {},
      dispatch: async () => ({ channel: "email" }),
    });
    assert.equal(held.skipped, true);
    assert.equal(called, false);
    const sent = await sendClaimedBillingNotices({
      env: { BILLING_NOTICES_SEND: "on" },
      claim: async () => [
        {
          id: "n1",
          tenant_id: "t1",
          kind: "platform_billing_invoice_issued",
          title: "Invoice SCL-2026-000001",
          body: issuedNotice(invoice).body,
          channel: "email",
          recipient: "example@example.com",
          fallback: {},
        },
      ],
      settle: async (_id, status) => {
        assert.equal(status, "sent");
      },
      dispatch: async (input) => {
        assert.equal(input.kind, "platform_billing_invoice_issued");
        assert.equal(input.email, "example@example.com");
        assert.match(input.ledger.kind, /^platform_/);
        return { channel: "email" };
      },
    });
    assert.equal(sent.sent, 1);
  });
});
