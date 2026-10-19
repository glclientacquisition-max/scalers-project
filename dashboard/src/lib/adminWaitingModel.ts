/**
 * One rule for "waiting for a number". Pure; safe to import from tests.
 * Archived or inactive businesses never wait.
 */

import type { AdminBusiness } from "@/lib/admin";
import type { PendingTenant } from "@/lib/didPool";

export function isWaitingForNumber(row: {
  sautikit_virtual_number: string;
  status?: AdminBusiness["status"];
  is_active?: boolean | null;
  archived_at?: string | null;
}): boolean {
  const number = String(row.sautikit_virtual_number || "").trim();
  if (!number.startsWith("pending:")) return false;
  if (row.status === "archived") return false;
  if (row.archived_at) return false;
  if (row.is_active === false) return false;
  return true;
}

/** Waiting shops derived from the business list (same rule as Today and Numbers Needs you). */
export function pendingFromBusinesses(businesses: AdminBusiness[]): PendingTenant[] {
  return businesses
    .filter((b) => isWaitingForNumber(b))
    .map((b) => ({
      id: b.id,
      business_name: b.business_name,
      sautikit_virtual_number: b.sautikit_virtual_number,
      created_at: b.created_at,
    }));
}
