/* eslint-disable @typescript-eslint/no-require-imports -- node:test loads this file with require() */
const wordmark = require("./wordmark");

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 48;
const RIGHT = PAGE_W - MARGIN;
const BOTTOM = 64;
const INK = "0.039 0.098 0.184";
const SOFT = "0.290 0.357 0.451";
const HAIR = "0.773 0.808 0.847";
const RULE = "0.361 0.420 0.478";
const ACCENT = "0 0.361 0.800";

const REGULAR = {
  " ": 278, ".": 278, ",": 278, "-": 333, "/": 278, ":": 278, "@": 1015,
  "(": 333, ")": 333, "0": 556, "1": 556, "2": 556, "3": 556, "4": 556,
  "5": 556, "6": 556, "7": 556, "8": 556, "9": 556,
  A: 667, B: 667, C: 722, D: 722, E: 667, F: 611, G: 778, H: 722, I: 278, J: 500,
  K: 667, L: 556, M: 833, N: 722, O: 778, P: 667, Q: 778, R: 722, S: 667, T: 611,
  U: 722, V: 667, W: 944, X: 667, Y: 667, Z: 611,
  a: 556, b: 556, c: 500, d: 556, e: 556, f: 278, g: 556, h: 556, i: 222, j: 222,
  k: 500, l: 222, m: 833, n: 556, o: 556, p: 556, q: 556, r: 333, s: 500, t: 278,
  u: 556, v: 500, w: 722, x: 500, y: 500, z: 500,
};

const BOLD = {
  ...REGULAR,
  A: 722, B: 722, C: 722, D: 722, E: 667, F: 611, G: 778, H: 722, I: 278, J: 556,
  K: 722, L: 611, M: 833, N: 722, O: 778, P: 667, Q: 778, R: 722, S: 667, T: 611,
  U: 722, V: 667, W: 944, X: 667, Y: 667, Z: 611,
  a: 556, b: 611, c: 556, d: 611, e: 556, f: 333, g: 611, h: 611, i: 278, j: 278,
  k: 556, l: 278, m: 889, n: 611, o: 611, p: 611, q: 611, r: 389, s: 556, t: 333,
  u: 611, v: 556, w: 778, x: 556, y: 556, z: 500,
};

function n(value) {
  return (Math.round(Number(value) * 100) / 100).toFixed(2);
}

function pdfText(value) {
  return String(value ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)")
    .replace(/·/g, "\\267");
}

function textWidth(value, size, bold) {
  const map = bold ? BOLD : REGULAR;
  let width = 0;
  for (const ch of String(value ?? "")) {
    width += map[ch] ?? (ch === "·" ? 278 : 500);
  }
  return (width * size) / 1000;
}

function wrapText(value, size, bold, maxWidth) {
  const words = String(value ?? "").split(/\s+/).filter(Boolean);
  if (!words.length) return [""];
  const lines = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (textWidth(next, size, bold) <= maxWidth) current = next;
    else {
      if (current) lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function text(cmds, value, x, y, opts = {}) {
  const size = opts.size || 10;
  const font = opts.bold ? "F2" : "F1";
  cmds.push(`BT ${opts.color || INK} rg /${font} ${n(size)} Tf 1 0 0 1 ${n(x)} ${n(y)} Tm (${pdfText(value)}) Tj ET`);
}

function textRight(cmds, value, right, y, opts = {}) {
  const size = opts.size || 10;
  text(cmds, value, right - textWidth(value, size, !!opts.bold), y, opts);
}

function rule(cmds, x1, x2, y, width, color) {
  cmds.push(`${color} RG ${n(width)} w ${n(x1)} ${n(y)} m ${n(x2)} ${n(y)} l S`);
}

function roundedRect(x, y, w, h, r) {
  const c = r * 0.5522847498;
  return [
    `${n(x + r)} ${n(y)} m`,
    `${n(x + w - r)} ${n(y)} l`,
    `${n(x + w - r + c)} ${n(y)} ${n(x + w)} ${n(y + r - c)} ${n(x + w)} ${n(y + r)} c`,
    `${n(x + w)} ${n(y + h - r)} l`,
    `${n(x + w)} ${n(y + h - r + c)} ${n(x + w - r + c)} ${n(y + h)} ${n(x + w - r)} ${n(y + h)} c`,
    `${n(x + r)} ${n(y + h)} l`,
    `${n(x + r - c)} ${n(y + h)} ${n(x)} ${n(y + h - r + c)} ${n(x)} ${n(y + h - r)} c`,
    `${n(x)} ${n(y + r)} l`,
    `${n(x)} ${n(y + r - c)} ${n(x + r - c)} ${n(y)} ${n(x + r)} ${n(y)} c h`,
  ].join(" ");
}

const QTY_RIGHT = RIGHT - 168;
const UNIT_RIGHT = RIGHT - 86;
const DESC_RIGHT = QTY_RIGHT - 36;
const DESC_WIDTH = DESC_RIGHT - MARGIN;

function logoBox(continued) {
  const width = continued ? 108 : 150;
  return { width, height: (width * wordmark.height) / wordmark.width };
}

function drawHeader(cmds, model, continued) {
  const top = PAGE_H - MARGIN;
  const logo = logoBox(continued);
  cmds.push(`q ${n(logo.width)} 0 0 ${n(logo.height)} ${n(MARGIN)} ${n(top - logo.height)} cm /Im1 Do Q`);
  if (continued) {
    textRight(cmds, model.title, RIGHT, top - 16, { size: 14, bold: true });
    textRight(cmds, model.number, RIGHT, top - 32, { size: 10, bold: true });
    const ruleY = top - Math.max(logo.height, 40) - 12;
    rule(cmds, MARGIN, RIGHT, ruleY, 1, RULE);
    return ruleY - 16;
  }
  let y = top - 16;
  textRight(cmds, model.title, RIGHT, y, { size: 20, bold: true });
  y -= 16;
  textRight(cmds, model.number, RIGHT, y, { size: 11, bold: true });
  for (const fact of model.facts) {
    y -= 13;
    textRight(cmds, fact, RIGHT, y, { size: 9, color: SOFT });
  }
  const pillSize = 8;
  const pillW = textWidth(model.statusLabel, pillSize, true) + 14;
  const pillH = 14;
  const pillX = RIGHT - pillW;
  const pillY = y - 22;
  cmds.push(`${INK} RG 0.8 w ${roundedRect(pillX, pillY, pillW, pillH, 7)} S`);
  text(cmds, model.statusLabel, pillX + 7, pillY + 3.6, { size: pillSize, bold: true });
  const blockBottom = Math.min(top - logo.height, pillY);
  const ruleY = blockBottom - 12;
  rule(cmds, MARGIN, RIGHT, ruleY, 1.1, RULE);
  return ruleY - 18;
}

function partyHeight(lines) {
  return 14 + lines.length * 13;
}

function drawParties(cmds, model, y) {
  const left = model.from;
  const right = model.billTo;
  const height = Math.max(partyHeight(left), partyHeight(right));
  text(cmds, "From", MARGIN, y - 9, { size: 9, bold: true, color: SOFT });
  text(cmds, "Bill to", MARGIN + 250, y - 9, { size: 9, bold: true, color: SOFT });
  left.forEach((line, index) => {
    text(cmds, line, MARGIN, y - 26 - index * 13, {
      size: index === 0 ? 11 : 9.5,
      bold: index === 0,
      color: index === 0 ? INK : SOFT,
    });
  });
  right.forEach((line, index) => {
    text(cmds, line, MARGIN + 250, y - 26 - index * 13, {
      size: index === 0 ? 11 : 9.5,
      bold: index === 0,
      color: index === 0 ? INK : SOFT,
    });
  });
  return y - height - 8;
}

function summaryHeight(model) {
  if (!model.summary) return 0;
  return 22 + (model.paymentFacts.length ? 36 : 0) + 8;
}

function drawSummary(cmds, model, y) {
  text(cmds, model.summary, MARGIN, y - 16, { size: 15, bold: true });
  if (!model.paymentFacts.length) return y - 28;
  const col = (RIGHT - MARGIN) / model.paymentFacts.length;
  model.paymentFacts.forEach((fact, index) => {
    const x = MARGIN + index * col;
    text(cmds, fact.label, x, y - 36, { size: 8, bold: true, color: SOFT });
    text(cmds, fact.value, x, y - 50, { size: 10, bold: true });
  });
  return y - summaryHeight(model);
}

function rowHeight(line) {
  const labelLines = wrapText(line.label, 10, false, DESC_WIDTH);
  const detail = line.detail ? 12 : 0;
  return 16 + labelLines.length * 13 + detail;
}

function drawRow(cmds, line, y) {
  const labels = wrapText(line.label, 10, false, DESC_WIDTH);
  let cursor = y - 14;
  labels.forEach((label, index) => {
    text(cmds, label, MARGIN, cursor, { size: 10 });
    if (index === 0) {
      textRight(cmds, line.quantity, QTY_RIGHT, cursor, { size: 10 });
      textRight(cmds, line.unit, UNIT_RIGHT, cursor, { size: 10 });
      textRight(cmds, line.amount, RIGHT, cursor, { size: 10 });
    }
    cursor -= 13;
  });
  if (line.detail) {
    text(cmds, line.detail, MARGIN, cursor, { size: 8.5, color: SOFT });
    cursor -= 12;
  }
  const bottom = y - rowHeight(line);
  rule(cmds, MARGIN, RIGHT, bottom + 4, 0.6, HAIR);
  return bottom;
}

function drawTableHeader(cmds, y) {
  const baseline = y - 10;
  text(cmds, "Description", MARGIN, baseline, { size: 8, bold: true, color: SOFT });
  textRight(cmds, "Qty", QTY_RIGHT, baseline, { size: 8, bold: true, color: SOFT });
  textRight(cmds, "Unit price", UNIT_RIGHT, baseline, { size: 8, bold: true, color: SOFT });
  textRight(cmds, "Amount", RIGHT, baseline, { size: 8, bold: true, color: SOFT });
  const bottom = y - 18;
  rule(cmds, MARGIN, RIGHT, bottom, 1, RULE);
  return bottom - 2;
}

function totalsHeight(model) {
  if (!model.totals.length) return 0;
  return model.totals.reduce((sum, row) => sum + (row.emphasis ? 22 : 16), 8);
}

function drawTotals(cmds, model, y) {
  const labelX = RIGHT - 210;
  let cursor = y - 4;
  for (const row of model.totals) {
    if (row.emphasis) {
      rule(cmds, labelX, RIGHT, cursor - 4, 1, RULE);
      cursor -= 18;
      text(cmds, row.label, labelX, cursor, { size: 11, bold: true });
      textRight(cmds, row.value, RIGHT, cursor, { size: 11, bold: true });
    } else {
      cursor -= 16;
      text(cmds, row.label, labelX, cursor, { size: 10, color: SOFT });
      textRight(cmds, row.value, RIGHT, cursor, { size: 10 });
    }
  }
  return cursor - 8;
}

function payHeight(model) {
  if (!model.payLabel && !model.note) return 0;
  return (model.payLabel ? 46 : 0) + (model.note ? 16 : 0) + (model.payUrl ? 14 : 0) + 8;
}

function drawPay(cmds, model, y, annots) {
  let cursor = y;
  if (model.payLabel) {
    const size = 12;
    const labelW = textWidth(model.payLabel, size, true);
    const w = Math.max(156, labelW + 28);
    const h = 30;
    const x = MARGIN;
    const bottom = cursor - h - 4;
    cmds.push(`${ACCENT} rg ${INK} RG 0.9 w ${roundedRect(x, bottom, w, h, 6)} B`);
    text(cmds, model.payLabel, x + (w - labelW) / 2, bottom + 9, { size, bold: true, color: "1 1 1" });
    if (model.payUrl) annots.push({ rect: [x, bottom, x + w, bottom + h], url: model.payUrl });
    if (model.partLabel) text(cmds, model.partLabel, x + w + 12, bottom + 9, { size: 10, color: SOFT });
    cursor = bottom - 6;
  }
  if (model.note) {
    cursor -= 12;
    text(cmds, model.note, MARGIN, cursor, { size: 9, color: SOFT });
  }
  if (model.payUrl) {
    cursor -= 12;
    text(cmds, model.payUrl, MARGIN, cursor, { size: 8, color: ACCENT });
    const urlW = textWidth(model.payUrl, 8, false);
    annots.push({ rect: [MARGIN, cursor - 2, MARGIN + urlW, cursor + 10], url: model.payUrl });
  }
  return cursor - 8;
}

function drawFooter(cmds, model, pageIndex, pageCount) {
  rule(cmds, MARGIN, RIGHT, 46, 0.8, RULE);
  text(cmds, model.footerContact, MARGIN, 30, { size: 8, color: SOFT });
  const numberW = textWidth(model.number, 8, false);
  text(cmds, model.number, (PAGE_W - numberW) / 2, 30, { size: 8, color: SOFT });
  textRight(cmds, `Page ${pageIndex} of ${pageCount}`, RIGHT, 30, { size: 8, color: SOFT });
}

function layout(model) {
  const pages = [];
  let cmds = [];
  let annots = [];
  let y = 0;

  function commit() {
    pages.push({ cmds, annots });
  }

  function open(continued) {
    if (pages.length || cmds.length) commit();
    cmds = [];
    annots = [];
    y = drawHeader(cmds, model, continued);
  }

  function ensure(height) {
    if (y - height < BOTTOM) open(true);
  }

  open(false);
  const parties = Math.max(partyHeight(model.from), partyHeight(model.billTo)) + 8;
  ensure(parties);
  y = drawParties(cmds, model, y);

  if (model.summary) {
    ensure(summaryHeight(model));
    y = drawSummary(cmds, model, y);
  }

  if (model.lines.length) {
    ensure(36);
    y = drawTableHeader(cmds, y);
    for (const line of model.lines) {
      const height = rowHeight(line);
      if (y - height < BOTTOM) {
        open(true);
        y = drawTableHeader(cmds, y);
      }
      y = drawRow(cmds, line, y);
    }
  }

  if (model.totals.length) {
    ensure(totalsHeight(model) + 8);
    y = drawTotals(cmds, model, y);
  }
  if (model.payLabel || model.note) {
    ensure(payHeight(model));
    y = drawPay(cmds, model, y, annots);
  }
  commit();

  pages.forEach((page, index) => drawFooter(page.cmds, model, index + 1, pages.length));
  return pages;
}

function buildPdf(pages) {
  let next = 6;
  const specs = pages.map((page) => {
    const contentId = next;
    next += 1;
    const annotIds = page.annots.map(() => {
      const id = next;
      next += 1;
      return id;
    });
    const pageId = next;
    next += 1;
    return { page, contentId, annotIds, pageId };
  });
  const objs = [];
  objs[1] = Buffer.from("<< /Type /Catalog /Pages 2 0 R >>");
  objs[2] = Buffer.from(
    `<< /Type /Pages /Kids [${specs.map((spec) => `${spec.pageId} 0 R`).join(" ")}] /Count ${specs.length} >>`
  );
  objs[3] = Buffer.from("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  objs[4] = Buffer.from("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>");
  objs[5] = Buffer.concat([
    Buffer.from(
      `<< /Type /XObject /Subtype /Image /Width ${wordmark.width} /Height ${wordmark.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${wordmark.bytes.length} >>\nstream\n`
    ),
    wordmark.bytes,
    Buffer.from("\nendstream"),
  ]);
  for (const spec of specs) {
    const stream = Buffer.from(spec.page.cmds.join("\n"));
    objs[spec.contentId] = Buffer.concat([
      Buffer.from(`<< /Length ${stream.length} >>\nstream\n`),
      stream,
      Buffer.from("\nendstream"),
    ]);
    spec.page.annots.forEach((annot, index) => {
      objs[spec.annotIds[index]] = Buffer.from(
        `<< /Type /Annot /Subtype /Link /Rect [${annot.rect.map(n).join(" ")}] /Border [0 0 0] /A << /S /URI /URI (${pdfText(annot.url)}) >> >>`
      );
    });
    const annots = spec.annotIds.length ? ` /Annots [${spec.annotIds.map((id) => `${id} 0 R`).join(" ")}]` : "";
    objs[spec.pageId] = Buffer.from(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${n(PAGE_W)} ${n(PAGE_H)}] /Contents ${spec.contentId} 0 R /Resources << /Font << /F1 3 0 R /F2 4 0 R >> /XObject << /Im1 5 0 R >> >>${annots} >>`
    );
  }

  let out = Buffer.from("%PDF-1.4\n");
  const offsets = [0];
  for (let i = 1; i < objs.length; i += 1) {
    offsets[i] = out.length;
    out = Buffer.concat([out, Buffer.from(`${i} 0 obj\n`), objs[i], Buffer.from("\nendobj\n")]);
  }
  const xref = out.length;
  let table = `xref\n0 ${objs.length}\n0000000000 65535 f \n`;
  for (let i = 1; i < objs.length; i += 1) table += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  out = Buffer.concat([out, Buffer.from(`${table}trailer << /Size ${objs.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`)]);
  return out;
}

function renderDocumentPdf(model) {
  return buildPdf(layout(model));
}

function renderInvoicePdf(model) {
  return renderDocumentPdf(model);
}

function renderReceiptPdf(model) {
  return renderDocumentPdf(model);
}

module.exports = { renderInvoicePdf, renderReceiptPdf };
