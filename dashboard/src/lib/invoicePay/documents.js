/* eslint-disable @typescript-eslint/no-require-imports -- node:test loads this file with require() */
const { formatKsh, toCents, splitKes, nextPart } = require("./money");
const { dataUri } = require("./wordmark");

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

function qtyLabel(value) {
  const raw = String(value ?? "1").trim();
  if (!/^\d+(?:\.\d+)?$/.test(raw)) return raw;
  const [whole, frac = ""] = raw.split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const trimmed = frac.replace(/0+$/, "");
  return trimmed ? `${grouped}.${trimmed}` : grouped;
}

function lineLabel(line) {
  if (line.description) return String(line.description);
  return KIND_LABEL[line.kind] || "Item";
}

function balanceOf(invoice) {
  const total = toCents(invoice.totalKes);
  const paid = toCents(invoice.amountPaidKes || "0");
  if (total == null || paid == null) return "0.00";
  const left = total - paid;
  return left > 0n ? (Number(left) / 100).toFixed(2) : "0.00";
}

function statusLabel(status, dueAt, now) {
  const name = String(status || "open").toLowerCase();
  if (name === "paid") return "Paid";
  if (name === "void") return "Void";
  if (name === "draft") return "Draft";
  const clock = now ? new Date(now).getTime() : Date.now();
  if (dueAt) {
    const due = new Date(dueAt).getTime();
    if (!Number.isNaN(due) && !Number.isNaN(clock) && due < clock) return "Overdue";
  }
  return "Open";
}

function payOffer(totalKes, paidKes) {
  const part = nextPart(splitKes(totalKes), paidKes || "0");
  if (!part) return { payLabel: "", partLabel: "" };
  const amount = formatKsh(toCents(part.amountKes));
  return {
    payLabel: `Pay ${amount}`,
    partLabel: part.count > 1 ? `Part ${part.index} of ${part.count}` : "",
  };
}

function partyLines(company) {
  return [company.legalName, company.product, company.address, company.city, company.kraPin, company.phone, company.email].filter(
    Boolean
  );
}

function billLines(billTo) {
  return [billTo.businessName, billTo.ownerName, billTo.email, billTo.phone].filter(Boolean);
}

function mapLines(lines, period) {
  let planSeen = false;
  return (lines || []).map((line) => {
    const detail = !planSeen && line.kind === "plan" && period ? period : "";
    if (line.kind === "plan") planSeen = true;
    return {
      label: lineLabel(line),
      detail,
      quantity: qtyLabel(line.quantity ?? "1"),
      unit: money(line.unitAmountKes ?? line.amountKes ?? "0"),
      amount: money(line.amountKes ?? "0"),
    };
  });
}

function periodOf(invoice) {
  if (!invoice.periodStart && !invoice.periodEnd) return "";
  return `${dateLabel(invoice.periodStart)} to ${dateLabel(invoice.periodEnd)}`;
}

/**
 * @param {object} input
 */
function invoiceModel(input) {
  const company = { ...EXAMPLE_COMPANY, ...(input.company || {}) };
  const invoice = input.invoice || {};
  const period = periodOf(invoice);
  const credits = invoice.creditsAppliedKes;
  const balance = balanceOf(invoice);
  const offer = payOffer(invoice.totalKes || "0", invoice.amountPaidKes || "0");
  const dueCents = toCents(balance);
  const payable = dueCents != null && dueCents > 0n;
  const totals = [{ label: "Subtotal", value: money(invoice.subtotalKes || "0") }];
  if (credits != null && Number(credits) > 0) totals.push({ label: "Credits applied", value: money(credits) });
  totals.push({ label: "Total", value: money(invoice.totalKes || "0") });
  totals.push({ label: "Amount paid", value: money(invoice.amountPaidKes || "0") });
  totals.push({ label: "Amount due", value: money(balance), emphasis: true });
  return {
    kind: "invoice",
    title: "Invoice",
    number: invoice.number || "",
    facts: [`Issued ${dateLabel(invoice.issuedAt)}`, `Due ${dateLabel(invoice.dueAt)}`].filter((line) => !/ $/.test(line)),
    statusLabel: statusLabel(invoice.status, invoice.dueAt, input.now),
    company,
    from: partyLines(company),
    billTo: billLines({
      businessName: input.billTo?.businessName || "",
      ownerName: input.billTo?.ownerName || "",
      email: input.billTo?.email || "",
      phone: input.billTo?.phone || "",
    }),
    lines: mapLines(input.lines, period),
    totals,
    summary: "",
    paymentFacts: [],
    payUrl: payable && input.payUrl ? String(input.payUrl) : "",
    payLabel: payable && input.payUrl ? offer.payLabel : "",
    partLabel: payable && input.payUrl ? offer.partLabel : "",
    note: payable ? "Pay with M-Pesa. Confirm the amount." : "",
    footerContact: [company.email, company.phone].filter(Boolean).join(" · "),
  };
}

function receiptModel(input) {
  const company = { ...EXAMPLE_COMPANY, ...(input.company || {}) };
  const receipt = input.receipt || {};
  const invoice = input.invoice || {};
  const amount = money(receipt.amountKes || "0");
  const paidOn = dateLabel(receipt.paidAt);
  const credits = invoice.creditsAppliedKes;
  const totals = [];
  if (invoice.subtotalKes != null) totals.push({ label: "Subtotal", value: money(invoice.subtotalKes) });
  if (credits != null && Number(credits) > 0) totals.push({ label: "Credits applied", value: money(credits) });
  if (invoice.totalKes != null) totals.push({ label: "Total", value: money(invoice.totalKes) });
  totals.push({ label: "Amount paid", value: amount, emphasis: true });
  const paymentFacts = [
    { label: "Method", value: receipt.method || "M-Pesa" },
    { label: "Reference", value: receipt.reference || "" },
    { label: "Invoice", value: receipt.invoiceNumber || "" },
  ].filter((fact) => fact.value);
  return {
    kind: "receipt",
    title: "Receipt",
    number: receipt.number || "",
    facts: paidOn ? [`Date ${paidOn}`] : [],
    statusLabel: "Paid",
    company,
    from: partyLines(company),
    billTo: billLines({
      businessName: input.billTo?.businessName || "",
      ownerName: input.billTo?.ownerName || "",
      email: input.billTo?.email || "",
      phone: input.billTo?.phone || "",
    }),
    lines: mapLines(input.lines, periodOf(invoice)),
    totals,
    summary: paidOn ? `Paid ${amount} on ${paidOn}` : `Paid ${amount}`,
    paymentFacts,
    payUrl: "",
    payLabel: "",
    partLabel: "",
    note: "",
    footerContact: [company.email, company.phone].filter(Boolean).join(" · "),
  };
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function pageShell(title, body) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
<style>
  @page { size: A4; margin: 14mm; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #F4F7FB; color: #0A192F; }
  body { font: 13px/1.4 ui-sans-serif, system-ui, "Segoe UI", Helvetica, Arial, sans-serif; }
  .sheet {
    width: 210mm; min-height: 297mm; margin: 0 auto; background: #fff;
    padding: 16mm 16mm 12mm; display: flex; flex-direction: column;
  }
  header { display: flex; justify-content: space-between; align-items: flex-start; gap: 24px; padding-bottom: 14px; border-bottom: 1.5px solid #5C6B7A; }
  .mark { width: 52mm; height: auto; display: block; }
  .head { text-align: right; }
  h1 { margin: 0; font-size: 22px; font-weight: 700; letter-spacing: -0.02em; }
  .number { margin: 4px 0 0; font-weight: 700; font-variant-numeric: tabular-nums; }
  .facts { margin: 6px 0 0; color: #4A5B73; font-size: 12px; }
  .facts p { margin: 0; }
  .pill {
    display: inline-block; margin-top: 8px; padding: 1px 8px; border: 1px solid #0A192F;
    border-radius: 999px; font-size: 11px; font-weight: 650; line-height: 16px;
  }
  .parties { display: grid; grid-template-columns: 1fr 1fr; gap: 28px; margin-top: 18px; }
  h2 { margin: 0 0 6px; font-size: 11px; font-weight: 650; color: #4A5B73; }
  .parties p { margin: 0; font-size: 12.5px; }
  .parties .name { font-weight: 700; }
  .summary { margin-top: 22px; }
  .summary .paid { margin: 0; font-size: 18px; font-weight: 700; letter-spacing: -0.02em; }
  .payfacts { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px; margin-top: 12px; }
  .payfacts span { display: block; color: #4A5B73; font-size: 11px; }
  .payfacts strong { display: block; margin-top: 2px; font-weight: 650; }
  table { width: 100%; border-collapse: collapse; margin-top: 22px; }
  th { text-align: left; font-size: 11px; font-weight: 650; color: #4A5B73; padding: 0 8px 8px 0; border-bottom: 1.5px solid #5C6B7A; }
  td { padding: 10px 8px 10px 0; border-bottom: 1px solid #C5CED8; vertical-align: top; font-size: 12.5px; }
  .num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .detail { display: block; margin-top: 2px; color: #4A5B73; font-size: 11px; }
  .totals { width: 240px; margin: 14px 0 0 auto; }
  .totals div { display: flex; justify-content: space-between; gap: 16px; padding: 4px 0; font-variant-numeric: tabular-nums; }
  .totals .label { color: #4A5B73; }
  .due { margin-top: 4px; padding-top: 8px; border-top: 1.5px solid #5C6B7A; font-size: 15px; font-weight: 700; }
  .due .label { color: #0A192F; }
  .pay { margin-top: 22px; }
  .pay a {
    display: inline-block; background: #005CCC; color: #fff; text-decoration: none;
    border: 1px solid #0A192F; border-radius: 8px; padding: 10px 16px; font-weight: 700; font-size: 14px;
  }
  .part { display: inline-block; margin-left: 12px; color: #4A5B73; font-size: 12px; }
  .note { margin: 8px 0 0; color: #4A5B73; font-size: 12px; }
  .url { margin: 2px 0 0; font-size: 11px; }
  .url a { color: #005CCC; }
  footer {
    margin-top: auto; padding-top: 10px; border-top: 1px solid #5C6B7A;
    display: flex; justify-content: space-between; gap: 12px;
    color: #4A5B73; font-size: 11px;
  }
  footer span:last-child { font-variant-numeric: tabular-nums; }
  @media print {
    html, body { background: #fff; }
    .sheet { margin: 0; }
    .pay a, .pill { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  }
</style>
</head>
<body>
<article class="sheet">
${body}
</article>
</body>
</html>`;
}

function partiesHtml(model) {
  const from = model.from
    .map((line, index) => `<p${index === 0 ? ' class="name"' : ""}>${escapeHtml(line)}</p>`)
    .join("");
  const bill = model.billTo
    .map((line, index) => `<p${index === 0 ? ' class="name"' : ""}>${escapeHtml(line)}</p>`)
    .join("");
  return `<section class="parties">
    <div><h2>From</h2>${from}</div>
    <div><h2>Bill to</h2>${bill}</div>
  </section>`;
}

function tableHtml(model) {
  if (!model.lines.length) return "";
  const rows = model.lines
    .map(
      (line) => `<tr>
        <td>${escapeHtml(line.label)}${line.detail ? `<span class="detail">${escapeHtml(line.detail)}</span>` : ""}</td>
        <td class="num">${escapeHtml(line.quantity)}</td>
        <td class="num">${escapeHtml(line.unit)}</td>
        <td class="num">${escapeHtml(line.amount)}</td>
      </tr>`
    )
    .join("");
  return `<table>
    <thead><tr><th>Description</th><th class="num">Qty</th><th class="num">Unit price</th><th class="num">Amount</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

function totalsHtml(model) {
  if (!model.totals.length) return "";
  const rows = model.totals
    .map(
      (row) => `<div class="${row.emphasis ? "due" : ""}"><span class="label">${escapeHtml(row.label)}</span><span class="num">${escapeHtml(row.value)}</span></div>`
    )
    .join("");
  return `<div class="totals">${rows}</div>`;
}

function renderDocumentHtml(model) {
  const facts = model.facts.map((fact) => `<p>${escapeHtml(fact)}</p>`).join("");
  const summary = model.summary
    ? `<section class="summary"><p class="paid">${escapeHtml(model.summary)}</p>${
        model.paymentFacts.length
          ? `<div class="payfacts">${model.paymentFacts
              .map((fact) => `<div><span>${escapeHtml(fact.label)}</span><strong>${escapeHtml(fact.value)}</strong></div>`)
              .join("")}</div>`
          : ""
      }</section>`
    : "";
  const pay = model.payLabel
    ? `<section class="pay"><a href="${escapeHtml(model.payUrl)}">${escapeHtml(model.payLabel)}</a>${
        model.partLabel ? `<span class="part">${escapeHtml(model.partLabel)}</span>` : ""
      }${model.note ? `<p class="note">${escapeHtml(model.note)}</p>` : ""}<p class="url"><a href="${escapeHtml(model.payUrl)}">${escapeHtml(model.payUrl)}</a></p></section>`
    : model.note
      ? `<p class="note">${escapeHtml(model.note)}</p>`
      : "";
  return pageShell(
    `${model.title} ${model.number}`,
    `<header>
      <img class="mark" alt="Scalers" src="${dataUri}">
      <div class="head">
        <h1>${escapeHtml(model.title)}</h1>
        <p class="number">${escapeHtml(model.number)}</p>
        <div class="facts">${facts}</div>
        <span class="pill">${escapeHtml(model.statusLabel)}</span>
      </div>
    </header>
    ${partiesHtml(model)}
    ${summary}
    ${tableHtml(model)}
    ${totalsHtml(model)}
    ${pay}
    <footer>
      <span>${escapeHtml(model.footerContact)}</span>
      <span>${escapeHtml(model.number)}</span>
      <span>Page 1 of 1</span>
    </footer>`
  );
}

function renderInvoiceHtml(model) {
  return renderDocumentHtml(model);
}

function renderReceiptHtml(model) {
  return renderDocumentHtml(model);
}

module.exports = {
  EXAMPLE_COMPANY,
  OWNER_SUPPLIED_DETAILS,
  invoiceModel,
  receiptModel,
  renderInvoiceHtml,
  renderReceiptHtml,
};
