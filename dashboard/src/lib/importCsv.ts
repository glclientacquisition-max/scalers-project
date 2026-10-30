/**
 * A CSV / TSV / text file -> the same one-item-per-line text the paste preview reads (30 Oct). Nothing is saved
 * here and no formula is run: cells are plain text, and the preview applies the same checks as a paste.
 */
export const IMPORT_FILE_MAX_BYTES = 1_000_000;
export const IMPORT_FILE_ACCEPT = ".csv,.tsv,.txt,text/csv,text/tab-separated-values,text/plain";

/** RFC 4180-ish: quoted cells, doubled quotes, commas/semicolons/tabs. */
export function parseDelimited(text: string): string[][] {
  const src = String(text || "").replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  const first = src.split("\n", 1)[0] || "";
  const counts: [string, number][] = [["\t", first.split("\t").length], [";", first.split(";").length], [",", first.split(",").length]];
  const delim = counts.sort((a, b) => b[1] - a[1])[0][1] > 1 ? counts[0][0] : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') { cell += '"'; i += 1; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && cell.trim() === "") { quoted = true; cell = ""; }
    else if (ch === delim) { row.push(cell.trim()); cell = ""; }
    else if (ch === "\n") { row.push(cell.trim()); rows.push(row); row = []; cell = ""; }
    else cell += ch;
  }
  if (cell.trim() || row.length) { row.push(cell.trim()); rows.push(row); }
  return rows.filter((r) => r.some((c) => c));
}

const NAME_H = /^(name|item|items|service|services|product|products|jina|bidhaa|huduma|description)$/i;
const PRICE_H = /^(price|prices|cost|amount|bei|rate|ksh|kes|price \(ksh\)|price ksh)$/i;

/** Rows -> "Name - price" lines. A header row picks the columns; otherwise first cell is the name, last the price. */
export function delimitedToPasteText(text: string): string {
  const rows = parseDelimited(text);
  if (!rows.length) return "";
  const head = rows[0].map((c) => c.toLowerCase().trim());
  let nameCol = head.findIndex((c) => NAME_H.test(c));
  const priceCol = head.findIndex((c) => PRICE_H.test(c));
  const hasHeader = nameCol >= 0 || priceCol >= 0;
  if (nameCol < 0) nameCol = 0;
  const body = hasHeader ? rows.slice(1) : rows;
  return body
    .map((r) => {
      const name = (r[nameCol] || "").replace(/\s+/g, " ").trim();
      const pc = priceCol >= 0 ? priceCol : r.length > 1 ? r.length - 1 : -1;
      const price = pc >= 0 && pc !== nameCol ? (r[pc] || "").trim() : "";
      return price ? `${name} - ${price}` : name;
    })
    .filter((l) => l.trim())
    .join("\n");
}
