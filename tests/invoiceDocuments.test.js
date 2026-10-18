const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  EXAMPLE_COMPANY,
  OWNER_SUPPLIED_DETAILS,
  invoiceModel,
  renderInvoiceHtml,
  renderReceiptHtml,
} = require("../dashboard/src/lib/invoicePay/documents");
const { renderInvoicePdf, renderReceiptPdf } = require("../dashboard/src/lib/invoicePay/pdf");
const { invoiceDocumentFor, shapeBillingHistory } = require("../dashboard/src/lib/invoicePay/history");
const { openInvoice, paidInvoice, receiptDoc, splitInvoice } = require("../dashboard/src/lib/invoicePay/samples");
const {
  issuedNotice,
  dueSoonNotice,
  overdueNotice,
  paymentReceivedNotice,
} = require("../src/billing/invoiceNotices");
const { sendClaimedBillingNotices } = require("../src/billing/billingNoticeSend");

function sampleDocs() {
  return { invoice: openInvoice(), receipt: receiptDoc() };
}

describe("invoice documents", () => {
  it("shows the example company, the locked prices, and no VAT", () => {
    const { invoice, receipt } = sampleDocs();
    assert.equal(invoice.company.address, EXAMPLE_COMPANY.address);
    assert.match(invoice.company.kraPin, /^example/);
    assert.equal(invoice.statusLabel, "Open");
    assert.equal(invoice.lines.length, 5);
    assert.equal(invoice.lines[0].label, "Growth plan, monthly (Business Assistant)");
    assert.equal(invoice.lines[0].detail, "1 Oct 2026 to 1 Nov 2026");
    assert.equal(invoice.lines[0].unit, "KSh 18,000");
    assert.equal(invoice.lines[1].label, "Extra minutes, inbound");
    assert.equal(invoice.lines[1].unit, "KSh 25");
    assert.equal(invoice.lines[2].unit, "KSh 500");
    assert.equal(invoice.lines[3].unit, "KSh 1");
    assert.equal(invoice.totals.find((row) => row.label === "Subtotal").value, "KSh 20,600");
    assert.equal(invoice.totals.find((row) => row.label === "Credits applied").value, "KSh 600");
    assert.equal(invoice.totals.find((row) => row.emphasis).label, "Amount due");
    assert.equal(invoice.totals.find((row) => row.emphasis).value, "KSh 20,000");
    assert.equal(invoice.payLabel, "Pay KSh 20,000");
    assert.equal(invoice.partLabel, "");
    assert.match(invoice.payUrl, /\/pay\/example-token$/);
    const html = renderInvoiceHtml(invoice).replace(/src="data:image[^"]*"/, 'src=""');
    const receiptHtml = renderReceiptHtml(receipt);
    assert.match(html, /<h1>Invoice<\/h1>/);
    assert.match(html, /class="pill">Open</);
    assert.match(html, /<h2>From<\/h2>[\s\S]*example address/);
    assert.match(html, /<h2>Bill to<\/h2>/);
    assert.match(
      html,
      /Unit price[\s\S]*Growth plan, monthly \(Business Assistant\)[\s\S]*1 Oct 2026 to 1 Nov 2026[\s\S]*Amount due[\s\S]*Pay KSh 20,000[\s\S]*Page 1 of 1/
    );
    assert.match(html, /example KRA PIN/);
    assert.match(html, /Pay with M-Pesa/);
    assert.doesNotMatch(html, /VAT/);
    assert.doesNotMatch(receiptHtml, /VAT/);
    assert.match(receiptHtml, /Paid KSh 20,000 on 18 Oct 2026/);
    assert.match(receiptHtml, /example-bachs-ref/);
    assert.match(receiptHtml, /Extra seats/);
    assert.ok(OWNER_SUPPLIED_DETAILS.some((line) => /KRA PIN/.test(line)));
    const pdf = renderInvoicePdf(invoice);
    const receiptPdf = renderReceiptPdf(receipt);
    const raw = pdf.toString("latin1");
    assert.equal(pdf.subarray(0, 5).toString(), "%PDF-");
    assert.match(raw, /DCTDecode/);
    assert.match(raw, /SCL-2026-000001/);
    assert.match(raw, /Amount due/);
    assert.match(raw, /From/);
    assert.match(raw, /Page 1 of 1/);
    assert.match(raw, /Pay KSh 20,000/);
    assert.doesNotMatch(raw, /48 748 m/);
    assert.doesNotMatch(raw, /VAT/);
    const receiptRaw = receiptPdf.toString("latin1");
    assert.match(receiptRaw, /Paid KSh 20,000 on 18 Oct 2026/);
    assert.match(receiptRaw, /example-bachs-ref/);
    assert.doesNotMatch(receiptRaw, /VAT/);
  });

  it("marks a paid invoice and splits a balance above KSh 150,000", () => {
    const paid = paidInvoice();
    assert.equal(paid.statusLabel, "Paid");
    assert.equal(paid.payLabel, "");
    assert.equal(paid.totals.find((row) => row.label === "Amount due").value, "KSh 0");
    assert.doesNotMatch(renderInvoiceHtml(paid), /Pay KSh/);
    const split = splitInvoice();
    assert.equal(split.statusLabel, "Open");
    assert.equal(split.lines[1].quantity, "5,600");
    assert.equal(split.lines[1].unit, "KSh 25");
    assert.equal(split.payLabel, "Pay KSh 80,000");
    assert.equal(split.partLabel, "Part 1 of 2");
    assert.match(renderInvoiceHtml(split), /Part 1 of 2/);
    assert.match(renderInvoicePdf(split).toString("latin1"), /Part 1 of 2/);
  });

  it("derives Overdue from an open invoice past its due date", () => {
    const overdue = invoiceDocumentFor(
      {
        invoice_number: "SCL-2026-000009",
        status: "open",
        due_at: "2020-01-01T00:00:00Z",
        subtotal_kes: "10",
        total_kes: "10",
        amount_paid_kes: "0",
      },
      [],
      { businessName: "example business" },
      ""
    );
    assert.equal(overdue.statusLabel, "Overdue");
    assert.equal(overdue.payLabel, "");
    const voided = invoiceModel({
      now: "2026-10-18T08:00:00Z",
      invoice: { number: "SCL-2026-000010", status: "void", totalKes: "10", subtotalKes: "10", amountPaidKes: "0" },
    });
    assert.equal(voided.statusLabel, "Void");
  });

  it("numbers a second page when the line table runs past one sheet", () => {
    const long = invoiceModel({
      now: "2026-10-18T08:00:00Z",
      invoice: {
        number: "SCL-2026-000099",
        status: "open",
        issuedAt: "2026-10-18T08:00:00Z",
        dueAt: "2026-10-25T08:00:00Z",
        subtotalKes: "40",
        totalKes: "40",
        amountPaidKes: "0",
      },
      lines: Array.from({ length: 40 }, () => ({
        kind: "extra_minutes",
        description: "Extra minutes, inbound",
        quantity: "1",
        unitAmountKes: "1",
        amountKes: "1",
      })),
    });
    const raw = renderInvoicePdf(long).toString("latin1");
    const count = Number(raw.match(/\/Count (\d+)/)[1]);
    assert.ok(count >= 2);
    assert.match(raw, new RegExp(`Page 1 of ${count}`));
    assert.match(raw, new RegExp(`Page ${count} of ${count}`));
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
