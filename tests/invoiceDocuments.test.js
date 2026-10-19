const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  invoiceModel,
  renderInvoiceHtml,
  renderReceiptHtml,
} = require("../dashboard/src/lib/invoicePay/documents");
const { letterheadFromCompanyRow, letterheadFromInvoice, letterheadForInvoice } = require("../dashboard/src/lib/invoicePay/company");
const { renderInvoicePdf, renderReceiptPdf } = require("../dashboard/src/lib/invoicePay/pdf");
const { invoiceDocumentFor, receiptDocumentFor, shapeBillingHistory } = require("../dashboard/src/lib/invoicePay/history");
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
  it("shows the confirmed letterhead, the locked prices, and no VAT", () => {
    const { invoice, receipt } = sampleDocs();
    assert.equal(invoice.company.legalName, "Scalers Ventures");
    assert.equal(invoice.company.phone, "+254119774470");
    assert.equal(invoice.company.email, "support@scalers.co.ke");
    assert.equal(invoice.company.address, "");
    assert.equal(invoice.company.city, "");
    assert.equal(invoice.company.kraPin, "");
    assert.deepEqual(invoice.from, [
      "Scalers Ventures",
      "Business Assistant",
      "+254119774470",
      "support@scalers.co.ke",
    ]);
    assert.equal(invoice.footerContact, "support@scalers.co.ke · +254119774470");
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
    assert.equal(invoice.totals.find((row) => row.label === "Credits applied").value, "-KSh 600");
    assert.equal(receipt.totals.find((row) => row.label === "Credits applied").value, "-KSh 600");
    assert.equal(invoice.totals.find((row) => row.emphasis).label, "Amount due");
    assert.equal(invoice.totals.find((row) => row.emphasis).value, "KSh 20,000");
    assert.equal(invoice.payLabel, "Pay KSh 20,000");
    assert.equal(invoice.partLabel, "");
    assert.match(invoice.payUrl, /\/pay\/example-token$/);
    const html = renderInvoiceHtml(invoice).replace(/src="data:image[^"]*"/, 'src=""');
    const receiptHtml = renderReceiptHtml(receipt).replace(/src="data:image[^"]*"/, 'src=""');
    const fromBlock = html.slice(html.indexOf("<h2>From</h2>"), html.indexOf("<h2>Bill to</h2>"));
    assert.match(html, /<h1>Invoice<\/h1>/);
    assert.match(html, /class="pill">Open</);
    assert.match(fromBlock, /Scalers Ventures/);
    assert.match(fromBlock, /\+254119774470/);
    assert.match(fromBlock, /support@scalers\.co\.ke/);
    assert.doesNotMatch(fromBlock, /example|KRA PIN|address|city/i);
    assert.match(html, /<h2>Bill to<\/h2>/);
    assert.match(
      html,
      /Unit price[\s\S]*Growth plan, monthly \(Business Assistant\)[\s\S]*1 Oct 2026 to 1 Nov 2026[\s\S]*Amount due[\s\S]*Pay KSh 20,000[\s\S]*Page 1 of 1/
    );
    assert.match(html, /support@scalers\.co\.ke/);
    assert.match(html, /-KSh 600/);
    assert.match(receiptHtml, /-KSh 600/);
    assert.match(html, /Pay with M-Pesa/);
    assert.doesNotMatch(html, /VAT/);
    assert.doesNotMatch(receiptHtml, /VAT/);
    assert.match(receiptHtml, /Paid KSh 20,000 on 18 Oct 2026/);
    assert.match(receiptHtml, /example-bachs-ref/);
    assert.match(receiptHtml, /Extra seats/);
    assert.match(receiptHtml, /Scalers Ventures/);
    assert.doesNotMatch(receiptHtml, /example address|example city|example KRA PIN/);
    const pdf = renderInvoicePdf(invoice);
    const receiptPdf = renderReceiptPdf(receipt);
    const raw = pdf.toString("latin1");
    assert.equal(pdf.subarray(0, 5).toString(), "%PDF-");
    assert.match(raw, /DCTDecode/);
    assert.match(raw, /SCL-2026-000001/);
    assert.match(raw, /Amount due/);
    assert.match(raw, /From/);
    assert.match(raw, /Page 1 of 1/);
    assert.match(raw, /-KSh 600/);
    assert.match(raw, /Pay KSh 20,000/);
    assert.doesNotMatch(raw, /48 748 m/);
    assert.doesNotMatch(raw, /VAT/);
    const receiptRaw = receiptPdf.toString("latin1");
    assert.match(receiptRaw, /-KSh 600/);
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
    assert.equal(split.totals.find((row) => row.label === "Credits applied").value, "-KSh 200");
    assert.equal(split.partLabel, "Part 1 of 2");
    assert.match(renderInvoiceHtml(split), /Part 1 of 2/);
    assert.match(renderInvoicePdf(split).toString("latin1"), /Part 1 of 2/);
  });

  it("omits a blank address and KRA PIN, and prints them once they are set", () => {
    const shown = invoiceModel({
      now: "2026-10-18T08:00:00Z",
      company: {
        legalName: "Scalers Ventures",
        address: "Westlands",
        city: "Nairobi",
        kraPin: "A123456789B",
        phone: "+254119774470",
        email: "support@scalers.co.ke",
      },
      invoice: { number: "SCL-2026-000003", status: "open", totalKes: "10", subtotalKes: "10", amountPaidKes: "0" },
    });
    assert.deepEqual(shown.from, [
      "Scalers Ventures",
      "Business Assistant",
      "Westlands",
      "Nairobi",
      "A123456789B",
      "+254119774470",
      "support@scalers.co.ke",
    ]);
    const html = renderInvoiceHtml(shown);
    assert.match(html, /Westlands/);
    assert.match(html, /A123456789B/);
    assert.doesNotMatch(html, /KRA PIN|example address/);
  });

  it("renders an issued invoice from its snapshot and leaves a draft to the live row", async () => {
    const issued = invoiceDocumentFor(
      {
        invoice_number: "SCL-2026-000004",
        status: "open",
        subtotal_kes: "10",
        total_kes: "10",
        amount_paid_kes: "0",
        issuer_legal_name: "Scalers Ventures",
        issuer_product: "Business Assistant",
        issuer_phone: "+254119774470",
        issuer_email: "support@scalers.co.ke",
        issuer_address: null,
        issuer_kra_pin: null,
      },
      [],
      { businessName: "example business" },
      ""
    );
    assert.equal(issued.company.legalName, "Scalers Ventures");
    assert.equal(issued.company.address, "");
    assert.equal(issued.company.kraPin, "");
    const receipt = receiptDocumentFor(
      {
        receipt_number: "RCT-2026-000004",
        amount_kes: "10",
        method: "M-Pesa",
        provider_ref: "ref",
        paid_at: "2026-10-18T12:00:00Z",
      },
      { businessName: "example business" },
      {
        invoice_number: "SCL-2026-000004",
        issuer_legal_name: "Old Letterhead",
        issuer_phone: "+254119774470",
        issuer_email: "support@scalers.co.ke",
      },
      []
    );
    assert.equal(receipt.company.legalName, "Old Letterhead");
    const live = {
      legal_name: "Scalers Ventures",
      product: "Business Assistant",
      phone: "+254119774470",
      email: "support@scalers.co.ke",
      address: null,
      city: "  ",
      kra_pin: "",
    };
    assert.equal(letterheadFromInvoice({ status: "draft" }), null);
    assert.equal(letterheadFromCompanyRow(live).city, null);
    assert.equal(letterheadFromCompanyRow(live).kraPin, null);
    const admin = {
      from() {
        return {
          select() {
            return { eq() { return { maybeSingle: async () => ({ data: live }) }; } };
          },
        };
      },
    };
    const draft = await letterheadForInvoice(admin, { status: "draft", issuer_legal_name: null });
    assert.equal(draft.legalName, "Scalers Ventures");
    assert.equal(draft.address, null);
    const kept = await letterheadForInvoice(admin, { issuer_legal_name: "Old Letterhead", issuer_phone: "+254700000000" });
    assert.equal(kept.legalName, "Old Letterhead");
    assert.equal(kept.phone, "+254700000000");
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
        {
          id: "inv-2",
          invoice_number: "SCL-2026-000002",
          status: "open",
          subtotal_kes: "20600",
          credits_applied_kes: "600",
          total_kes: "20000",
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
    assert.equal(history.invoices[0].credits_applied, null);
    assert.equal(history.invoices[1].credits_applied, "-KSh 600");
    assert.equal(history.invoices[0].total_due, "KSh 7,000");
    assert.equal(history.invoices[0].tax_kes, null);
    assert.equal(history.invoices[0].pay_link_path, "/api/billing/invoices/inv-1/pay-link");
    assert.equal(history.receipts[0].pdf_path, "/api/billing/receipts/rct-1/pdf");
    assert.equal(history.invoices[0].lines[0].description, "Business Assistant plan");
  });

  it("keeps a credit total negative and does not offer pay", () => {
    const history = shapeBillingHistory({
      invoices: [
        {
          id: "inv-credit",
          invoice_number: null,
          status: "open",
          subtotal_kes: "-1000.00",
          credits_applied_kes: null,
          total_kes: "-1000.00",
          amount_paid_kes: "0",
          tax_kes: null,
        },
        {
          id: "inv-zero",
          status: "open",
          subtotal_kes: "0.00",
          total_kes: "0.00",
          amount_paid_kes: "0",
        },
      ],
      lines: [
        {
          invoice_id: "inv-credit",
          kind: "extra_seats",
          description: "Seat removed",
          quantity: "1",
          unit_amount_kes: "-1000.00",
          amount_kes: "-1000.00",
        },
      ],
      receipts: [],
    });
    assert.equal(history.invoices[0].subtotal, "KSh -1,000");
    assert.equal(history.invoices[0].total_due, "KSh -1,000");
    assert.equal(history.invoices[0].balance, "KSh 0");
    assert.equal(history.invoices[0].pay_link_path, null);
    assert.equal(history.invoices[0].lines[0].unit_price, "KSh -1,000");
    assert.equal(history.invoices[0].lines[0].amount, "KSh -1,000");
    assert.equal(history.invoices[1].total_due, "KSh 0");
    assert.equal(history.invoices[1].balance, "KSh 0");
    assert.equal(history.invoices[1].pay_link_path, null);
    const doc = invoiceModel({
      invoice: {
        number: "",
        status: "draft",
        subtotalKes: "-1000.00",
        totalKes: "-1000.00",
        amountPaidKes: "0",
      },
      lines: [
        {
          kind: "extra_seats",
          description: "Seat removed",
          quantity: "1",
          unitAmountKes: "-1000.00",
          amountKes: "-1000.00",
        },
      ],
    });
    assert.equal(doc.lines[0].amount, "KSh -1,000");
    assert.equal(doc.totals.find((row) => row.label === "Total").value, "KSh -1,000");
    assert.equal(doc.totals.find((row) => row.label === "Amount due").value, "KSh 0");
    assert.equal(doc.payLabel, "");
    assert.equal(doc.payUrl, "");
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
