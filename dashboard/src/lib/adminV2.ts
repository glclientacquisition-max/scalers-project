/** Super Admin v2 surfaces (access requests queue, etc.). */
export function isAdminV2Enabled(): boolean {
  const raw = String(process.env.ADMIN_V2 || "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}
