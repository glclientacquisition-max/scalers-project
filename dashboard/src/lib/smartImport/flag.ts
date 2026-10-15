/** DESK_SMART_IMPORT: the unified Import sheet (photos, PDFs, every tab). Default off. */
export function smartImportEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return /^(1|true|on|yes)$/i.test(String(env.DESK_SMART_IMPORT || "").trim());
}
