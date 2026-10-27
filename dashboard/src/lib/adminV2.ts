/**
 * The one ADMIN_V2 switch. Every page, layout and route asks this; nothing reads process.env.ADMIN_V2 directly.
 * On: "on" (what prod and staging set), plus "true", "1" and "yes", any case. Anything else, or unset, is off.
 */
export function adminV2FlagOn(raw: string | undefined | null): boolean {
  const v = String(raw ?? "").trim().toLowerCase();
  return v === "on" || v === "true" || v === "1" || v === "yes";
}

/** Super Admin v2: the six-item shell, its routes and redirects, and the access request queue. */
export function isAdminV2Enabled(): boolean {
  return adminV2FlagOn(process.env.ADMIN_V2);
}
