function pdfEscape(value) {
  return String(value ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
}

/**
 * One-page Helvetica PDF. Coordinates are points from the bottom-left.
 * @param {{ title: string, lines: { text: string, size?: number, bold?: boolean, gap?: number }[] }} doc
 */
function renderPdf(doc) {
  const commands = ["0.11 0.10 0.08 rg", "0.75 0.72 0.68 RG", "0.6 w", "48 748 m 547 748 l S"];
  let y = 800;
  for (const line of doc.lines) {
    const size = line.size || 11;
    const font = line.bold ? "F2" : "F1";
    if (line.gap) y -= line.gap;
    y -= size + 6;
    if (y < 48) break;
    commands.push(`BT /${font} ${size} Tf 48 ${y} Td (${pdfEscape(line.text)}) Tj ET`);
  }
  commands.push("0.2 w 48 742 m 547 742 l S");
  const stream = commands.join("\n");
  const objects = [];
  objects.push("1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n");
  objects.push("2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n");
  objects.push(
    "3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> >> endobj\n"
  );
  objects.push(`4 0 obj << /Length ${Buffer.byteLength(stream)} >> stream\n${stream}\nendstream endobj\n`);
  objects.push("5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj\n");
  objects.push("6 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >> endobj\n");

  let body = "%PDF-1.4\n";
  const offsets = [0];
  for (const obj of objects) {
    offsets.push(Buffer.byteLength(body));
    body += obj;
  }
  const xref = Buffer.byteLength(body);
  body += `xref\n0 ${objects.length + 1}\n`;
  body += "0000000000 65535 f \n";
  for (let i = 1; i < offsets.length; i += 1) {
    body += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  body += `trailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(body);
}

function invoicePdfLines(model) {
  const lines = [
    { text: "Scalers", size: 18, bold: true },
    { text: model.company.product, size: 12 },
    { text: model.company.address },
    { text: model.company.city },
    { text: model.company.kraPin },
    { text: model.company.phone },
    { text: model.company.email },
    { text: "Invoice", size: 20, bold: true, gap: 16 },
    { text: model.number, bold: true },
    { text: `Issued ${model.issued}` },
    { text: `Due ${model.due}` },
  ];
  if (model.period) lines.push({ text: `Period ${model.period}` });
  lines.push({ text: "Bill to", bold: true, gap: 12 });
  lines.push({ text: model.billTo.businessName });
  if (model.billTo.ownerName) lines.push({ text: model.billTo.ownerName });
  if (model.billTo.email) lines.push({ text: model.billTo.email });
  if (model.billTo.phone) lines.push({ text: model.billTo.phone });
  lines.push({ text: "Description", bold: true, gap: 14 });
  for (const line of model.lines) {
    lines.push({ text: `${line.label}    ${line.quantity} x ${line.unit}    ${line.amount}` });
  }
  lines.push({ text: `Subtotal ${model.subtotal}`, gap: 12 });
  if (model.credits) lines.push({ text: `Credits applied ${model.credits}` });
  lines.push({ text: `Total due ${model.total}`, bold: true });
  lines.push({ text: `Amount paid ${model.paid}` });
  lines.push({ text: `Balance ${model.balance}` });
  if (model.payUrl) lines.push({ text: `Pay now ${model.payUrl}`, gap: 12 });
  lines.push({ text: model.instructions });
  return lines;
}

function receiptPdfLines(model) {
  return [
    { text: "Scalers", size: 18, bold: true },
    { text: model.company.product, size: 12 },
    { text: model.company.address },
    { text: model.company.city },
    { text: model.company.kraPin },
    { text: model.company.phone },
    { text: model.company.email },
    { text: "Receipt", size: 20, bold: true, gap: 16 },
    { text: "PAID", size: 16, bold: true },
    { text: model.number, bold: true },
    { text: `Invoice ${model.invoiceNumber}` },
    { text: `Date ${model.paid}` },
    { text: `Method ${model.method}` },
    { text: `Reference ${model.reference}` },
    { text: "Bill to", bold: true, gap: 12 },
    { text: model.billTo.businessName },
    { text: model.billTo.ownerName },
    { text: model.billTo.email },
    { text: model.billTo.phone },
    { text: `Amount ${model.amount}`, size: 14, bold: true, gap: 12 },
  ];
}

function renderInvoicePdf(model) {
  return renderPdf({ title: model.number, lines: invoicePdfLines(model) });
}

function renderReceiptPdf(model) {
  return renderPdf({ title: model.number, lines: receiptPdfLines(model) });
}

module.exports = { renderPdf, renderInvoicePdf, renderReceiptPdf };
