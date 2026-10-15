import "server-only";

import { allowRate } from "@/lib/rateLimit";
import { isOpsMailConfigured, sendOpsMail } from "@/lib/opsMail";
import { parseOpsEmails } from "@/lib/platformOpsModel";

/**
 * Tell ops a finished workspace has no phone number (pool empty). At most once a day per
 * workspace. Super Admin also lists these under pending tenants, so a mail failure is not silent.
 */
export async function notifyNumberPending(input: { tenantId: string; businessName: string }): Promise<void> {
  try {
    if (!(await allowRate(`number-pending-mail:${input.tenantId}`, 86400, 1))) return;
    const to = parseOpsEmails(process.env.SCALERS_OPS_ALERT_EMAILS || process.env.SCALERS_OPS_ALERT_EMAIL || "");
    console.warn("[setup] number pending for tenant", input.tenantId);
    if (!to.length || !isOpsMailConfigured()) return;
    await sendOpsMail({
      to,
      subject: `Number needed: ${input.businessName}`,
      text: `${input.businessName} finished setup but the number pool is empty.\nTenant: ${input.tenantId}\nAdd numbers to the pool, then assign one in Super Admin.`,
    });
  } catch (err) {
    console.warn("[setup] notify pending:", err instanceof Error ? err.message : err);
  }
}
