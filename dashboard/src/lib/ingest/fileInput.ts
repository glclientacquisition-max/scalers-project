/**
 * Files for smart import: photos (jpg, png, webp), PDFs, CSV. Validates type, size and
 * page count, then shapes a Gemini inlineData part. XLSX and HEIC are refused with a clear
 * next step (no heavy libraries in v1; the browser converts HEIC where it can).
 * Pure and browser-safe. Relative imports only so node tests can load it.
 */
export const IMPORT_FILE_MAX_BYTES = 10 * 1024 * 1024;
export const IMPORT_PDF_MAX_PAGES = 10;
export const IMPORT_FILE_TIMEOUT_MS = 45_000;

export type ImportFileKind = "image" | "pdf" | "csv";

export type ImportFileCheck =
  | { ok: true; kind: ImportFileKind; mimeType: string }
  | { ok: false; error: string };

const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

function extOf(name: string): string {
  const m = String(name || "").toLowerCase().match(/\.([a-z0-9]+)$/);
  return m ? m[1] : "";
}

/** Type from the browser's mime, falling back to the extension (some phones send none). */
export function classifyImportFile(file: { name: string; type: string; size: number }): ImportFileCheck {
  const ext = extOf(file.name);
  const type = String(file.type || "").toLowerCase();
  if (!file.size) return { ok: false, error: "That file is empty. Pick another one." };
  if (file.size > IMPORT_FILE_MAX_BYTES) return { ok: false, error: "That file is over 10 MB. Send a smaller photo or split the PDF." };
  if (type === "image/heic" || type === "image/heif" || ext === "heic" || ext === "heif") {
    return { ok: false, error: "iPhone HEIC photos can't be read here. Take a screenshot of it, or set the camera to Most Compatible, then try again." };
  }
  if (IMAGE_TYPES.has(type)) return { ok: true, kind: "image", mimeType: type };
  if (["jpg", "jpeg"].includes(ext)) return { ok: true, kind: "image", mimeType: "image/jpeg" };
  if (ext === "png") return { ok: true, kind: "image", mimeType: "image/png" };
  if (ext === "webp") return { ok: true, kind: "image", mimeType: "image/webp" };
  if (type === "application/pdf" || ext === "pdf") return { ok: true, kind: "pdf", mimeType: "application/pdf" };
  if (type === "text/csv" || ext === "csv" || (type === "text/plain" && ext === "txt")) {
    return { ok: true, kind: "csv", mimeType: "text/csv" };
  }
  if (ext === "xlsx" || ext === "xls" || type.includes("spreadsheet") || type.includes("excel")) {
    return { ok: false, error: "Excel files aren't read yet. In Excel or Google Sheets choose Download as CSV, then upload that." };
  }
  return { ok: false, error: "Upload a photo (JPG, PNG, WEBP), a PDF or a CSV file." };
}

/** Rough page count from the PDF bytes ("/Type /Page" objects). Good enough for a cap. */
export function countPdfPages(bytes: Uint8Array): number {
  // latin1 keeps byte offsets; PDF structure keywords are ASCII.
  let text = "";
  const step = 1 << 16;
  for (let i = 0; i < bytes.length; i += step) {
    text += String.fromCharCode(...bytes.subarray(i, Math.min(bytes.length, i + step)));
  }
  const matches = text.match(/\/Type\s*\/Page(?![a-zA-Z])/g);
  return matches ? matches.length : 0;
}

export function isPdfBytes(bytes: Uint8Array): boolean {
  return bytes.length > 4 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46;
}

/** Magic bytes agree with the claimed image type (stops a renamed file reaching the model). */
export function imageBytesMatch(bytes: Uint8Array, mimeType: string): boolean {
  if (mimeType === "image/jpeg") return bytes[0] === 0xff && bytes[1] === 0xd8;
  if (mimeType === "image/png") return bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  if (mimeType === "image/webp")
    return String.fromCharCode(...bytes.subarray(0, 4)) === "RIFF" && String.fromCharCode(...bytes.subarray(8, 12)) === "WEBP";
  return false;
}

export type PreparedImportFile =
  | { ok: true; kind: "image" | "pdf"; part: { inlineData: { mimeType: string; data: string } }; label: string }
  | { ok: true; kind: "csv"; text: string; label: string }
  | { ok: false; error: string };

function toBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== "undefined") return Buffer.from(bytes).toString("base64");
  let bin = "";
  for (let i = 0; i < bytes.length; i += 1) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

/** Validate a file's bytes and shape it for the model (or as text for CSV). */
export function prepareImportFile(file: { name: string; type: string; size: number }, bytes: Uint8Array): PreparedImportFile {
  const check = classifyImportFile({ ...file, size: bytes.length || file.size });
  if (!check.ok) return check;
  const label = String(file.name || "upload").slice(0, 80);
  if (check.kind === "csv") {
    const text = new TextDecoder("utf-8").decode(bytes).replace(/^\uFEFF/, "");
    if (text.trim().length < 3) return { ok: false, error: "That CSV is empty." };
    return { ok: true, kind: "csv", text: text.slice(0, 60_000), label };
  }
  if (check.kind === "pdf") {
    if (!isPdfBytes(bytes)) return { ok: false, error: "That PDF looks damaged. Export it again and retry." };
    const pages = countPdfPages(bytes);
    if (pages > IMPORT_PDF_MAX_PAGES) {
      return { ok: false, error: `That PDF has ${pages} pages. Upload up to ${IMPORT_PDF_MAX_PAGES} pages at a time.` };
    }
  }
  if (check.kind === "image" && !imageBytesMatch(bytes, check.mimeType)) {
    return { ok: false, error: "That photo couldn't be read. Try a JPG or PNG." };
  }
  return { ok: true, kind: check.kind, part: { inlineData: { mimeType: check.mimeType, data: toBase64(bytes) } }, label };
}
