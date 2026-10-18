/* eslint-disable @typescript-eslint/no-require-imports -- node:test loads this file with require() */
const { formatKsh, toCents } = require("./money");

/**
 * Real company details are not in the repo. Every stand-in starts with "example".
 * The owner supplies the real values before an invoice goes to a customer.
 */
const EXAMPLE_COMPANY = {
  legalName: "Scalers",
  product: "Business Assistant",
  address: "example address",
  city: "example city",
  kraPin: "example KRA PIN",
  phone: "example phone",
  email: "example email",
};

const OWNER_SUPPLIED_DETAILS = [
  "Legal company name, if it is not Scalers",
  "Physical address",
  "City",
  "KRA PIN",
  "Phone",
  "Billing email",
];

const KIND_LABEL = {
  plan: "Plan",
  extra_minutes: "Extra minutes",
  extra_seats: "Extra seats",
  message_credits: "Message credits",
  proration: "Proration",
};

function money(amount) {
  const cents = toCents(amount);
  if (cents == null) return "KSh 0";
  return formatKsh(cents);
}

function dateLabel(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Nairobi",
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
}

function lineLabel(line) {
  if (line.description) return String(line.description);
  return KIND_LABEL[line.kind] || "Item";
}

function balanceOf(invoice) {
  const total = toCents(invoice.totalKes);
  const paid = toCents(invoice.amountPaidKes || "0");
  if (total == null || paid == null) return "0";
  const left = total - paid;
  return left > 0n ? (Number(left) / 100).toFixed(2) : "0.00";
}

/**
 * @param {object} input
 */
function invoiceModel(input) {
  const company = { ...EXAMPLE_COMPANY, ...(input.company || {}) };
  const invoice = input.invoice || {};
  const lines = (input.lines || []).map((line) => ({
    label: lineLabel(line),
    quantity: String(line.quantity ?? "1"),
    unit: money(line.unitAmountKes ?? line.amountKes ?? "0"),
    amount: money(line.amountKes ?? "0"),
  }));
  const credits = invoice.creditsAppliedKes;
  return {
    company,
    billTo: {
      businessName: input.billTo?.businessName || "",
      ownerName: input.billTo?.ownerName || "",
      email: input.billTo?.email || "",
      phone: input.billTo?.phone || "",
    },
    number: invoice.number || "",
    issued: dateLabel(invoice.issuedAt),
    due: dateLabel(invoice.dueAt),
    period: invoice.periodStart || invoice.periodEnd
      ? `${dateLabel(invoice.periodStart)} to ${dateLabel(invoice.periodEnd)}`
      : "",
    lines,
    subtotal: money(invoice.subtotalKes || "0"),
    credits: credits != null && Number(credits) > 0 ? money(credits) : null,
    total: money(invoice.totalKes || "0"),
    paid: money(invoice.amountPaidKes || "0"),
    balance: money(balanceOf(invoice)),
    payUrl: input.payUrl || "",
    instructions: "Pay with M-Pesa. Open Pay now and confirm the amount.",
  };
}

function receiptModel(input) {
  const company = { ...EXAMPLE_COMPANY, ...(input.company || {}) };
  return {
    company,
    billTo: {
      businessName: input.billTo?.businessName || "",
      ownerName: input.billTo?.ownerName || "",
      email: input.billTo?.email || "",
      phone: input.billTo?.phone || "",
    },
    number: input.receipt?.number || "",
    invoiceNumber: input.receipt?.invoiceNumber || "",
    reference: input.receipt?.reference || "",
    amount: money(input.receipt?.amountKes || "0"),
    method: input.receipt?.method || "M-Pesa",
    paid: dateLabel(input.receipt?.paidAt),
    stamp: "PAID",
  };
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function partyHtml(company) {
  return [
    `<p class="name">${escapeHtml(company.legalName)}</p>`,
    `<p>${escapeHtml(company.product)}</p>`,
    `<p>${escapeHtml(company.address)}</p>`,
    `<p>${escapeHtml(company.city)}</p>`,
    `<p>${escapeHtml(company.kraPin)}</p>`,
    `<p>${escapeHtml(company.phone)}</p>`,
    `<p>${escapeHtml(company.email)}</p>`,
  ].join("");
}

function billToHtml(billTo) {
  return [
    `<p class="name">${escapeHtml(billTo.businessName)}</p>`,
    billTo.ownerName ? `<p>${escapeHtml(billTo.ownerName)}</p>` : "",
    billTo.email ? `<p>${escapeHtml(billTo.email)}</p>` : "",
    billTo.phone ? `<p>${escapeHtml(billTo.phone)}</p>` : "",
  ].join("");
}

function pageShell(title, body) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
<style>
  body { margin: 0; background: #f4f1ea; color: #1c1915; font: 15px/1.45 ui-sans-serif, system-ui, sans-serif; }
  main { max-width: 720px; margin: 24px auto; background: #fff; padding: 32px 28px 40px; }
  h1 { font-size: 28px; font-weight: 650; margin: 0; letter-spacing: -0.02em; }
  .row { display: flex; justify-content: space-between; gap: 24px; }
  .meta, .party { color: #5c564e; font-size: 13px; }
  .name { color: #1c1915; font-weight: 650; }
  table { width: 100%; border-collapse: collapse; margin-top: 28px; }
  th { text-align: left; font-size: 12px; color: #5c564e; font-weight: 600; padding: 0 0 8px; }
  td { padding: 10px 0; border-top: 1px solid #e6e1d8; vertical-align: top; }
  .num { text-align: right; font-variant-numeric: tabular-nums; }
  .totals { margin-top: 8px; margin-left: auto; width: 260px; }
  .totals div { display: flex; justify-content: space-between; padding: 6px 0; }
  .due { font-size: 18px; font-weight: 650; }
  a { color: #005ccc; }
  .stamp { font-size: 22px; font-weight: 700; letter-spacing: 0.08em; }
  .note { margin-top: 28px; color: #5c564e; font-size: 13px; }
</style>
</head>
<body>
<main>
${body}
</main>
</body>
</html>`;
}

function renderInvoiceHtml(model) {
  const lines = model.lines
    .map(
      (line) => `<tr>
        <td>${escapeHtml(line.label)}</td>
        <td class="num">${escapeHtml(line.quantity)}</td>
        <td class="num">${escapeHtml(line.unit)}</td>
        <td class="num">${escapeHtml(line.amount)}</td>
      </tr>`
    )
    .join("");
  const credits = model.credits
    ? `<div><span>Credits applied</span><span class="num">${escapeHtml(model.credits)}</span></div>`
    : "";
  const pay = model.payUrl
    ? `<p class="note"><a href="${escapeHtml(model.payUrl)}">Pay now</a></p>`
    : "";
  return pageShell(
    `Invoice ${model.number}`,
    `<div class="row">
      <div>
        <h1>Invoice</h1>
        <p class="meta">${escapeHtml(model.number)}</p>
      </div>
      <div class="party">${partyHtml(model.company)}</div>
    </div>
    <div class="row" style="margin-top:28px">
      <div>
        <p class="meta">Bill to</p>
        ${billToHtml(model.billTo)}
      </div>
      <div class="meta">
        <p>Issued ${escapeHtml(model.issued)}</p>
        <p>Due ${escapeHtml(model.due)}</p>
        ${model.period ? `<p>Period ${escapeHtml(model.period)}</p>` : ""}
      </div>
    </div>
    <table>
      <thead><tr><th>Description</th><th class="num">Qty</th><th class="num">Unit price</th><th class="num">Amount</th></tr></thead>
      <tbody>${lines}</tbody>
    </table>
    <div class="totals">
      <div><span>Subtotal</span><span class="num">${escapeHtml(model.subtotal)}</span></div>
      ${credits}
      <div class="due"><span>Total due</span><span class="num">${escapeHtml(model.total)}</span></div>
      <div><span>Amount paid</span><span class="num">${escapeHtml(model.paid)}</span></div>
      <div><span>Balance</span><span class="num">${escapeHtml(model.balance)}</span></div>
    </div>
    ${pay}
    <p class="note">${escapeHtml(model.instructions)}</p>`
  );
}

function renderReceiptHtml(model) {
  return pageShell(
    `Receipt ${model.number}`,
    `<div class="row">
      <div>
        <h1>Receipt</h1>
        <p class="meta">${escapeHtml(model.number)}</p>
        <p class="stamp">PAID</p>
      </div>
      <div class="party">${partyHtml(model.company)}</div>
    </div>
    <div class="row" style="margin-top:28px">
      <div>
        <p class="meta">Bill to</p>
        ${billToHtml(model.billTo)}
      </div>
      <div class="meta">
        <p>Invoice ${escapeHtml(model.invoiceNumber)}</p>
        <p>Date ${escapeHtml(model.paid)}</p>
        <p>Method ${escapeHtml(model.method)}</p>
        <p>Reference ${escapeHtml(model.reference)}</p>
      </div>
    </div>
    <div class="totals">
      <div class="due"><span>Amount</span><span class="num">${escapeHtml(model.amount)}</span></div>
    </div>`
  );
}

module.exports = {
  EXAMPLE_COMPANY,
  OWNER_SUPPLIED_DETAILS,
  invoiceModel,
  receiptModel,
  renderInvoiceHtml,
  renderReceiptHtml,
};
