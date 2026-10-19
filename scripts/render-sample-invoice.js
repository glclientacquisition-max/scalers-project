#!/usr/bin/env node
"use strict";

const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { renderInvoiceHtml, renderReceiptHtml } = require("../dashboard/src/lib/invoicePay/documents");
const { renderInvoicePdf, renderReceiptPdf } = require("../dashboard/src/lib/invoicePay/pdf");
const { openInvoice, paidInvoice, receiptDoc, splitInvoice } = require("../dashboard/src/lib/invoicePay/samples");

const dir = process.argv[2] || "/opt/cursor/artifacts";
fs.mkdirSync(dir, { recursive: true });

const docs = [
  ["invoice-SCL-2026-000001-open", renderInvoiceHtml(openInvoice()), renderInvoicePdf(openInvoice())],
  ["invoice-SCL-2026-000001-paid", renderInvoiceHtml(paidInvoice()), renderInvoicePdf(paidInvoice())],
  ["receipt-RCT-2026-000001", renderReceiptHtml(receiptDoc()), renderReceiptPdf(receiptDoc())],
  ["invoice-SCL-2026-000002-split", renderInvoiceHtml(splitInvoice()), renderInvoicePdf(splitInvoice())],
];

for (const [name, html, pdf] of docs) {
  const htmlPath = path.join(dir, `${name}.html`);
  const pdfPath = path.join(dir, `${name}.pdf`);
  fs.writeFileSync(htmlPath, html);
  fs.writeFileSync(pdfPath, pdf);
  const prefix = path.join(dir, name);
  execFileSync("pdftoppm", ["-png", "-r", "140", pdfPath, prefix], { stdio: "inherit" });
  const pages = fs.readdirSync(dir).filter((file) => file.startsWith(`${name}-`) && file.endsWith(".png")).sort();
  if (pages.length === 1) fs.renameSync(path.join(dir, pages[0]), `${prefix}.png`);
  console.log(htmlPath);
  console.log(pdfPath);
}
