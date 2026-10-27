import { isOwnerEmailConfigured, sendOwnerEmail } from "@/lib/ownerEmail";
import type { AccessRequestFields } from "@/lib/accessRequestLogic";

export async function notifyOwnerOfAccessRequest(fields: AccessRequestFields): Promise<void> {
  const to = String(process.env.ACCESS_REQUEST_NOTIFY_EMAIL || "").trim();
  if (!to || !isOwnerEmailConfigured()) return;

  const subject = `Access request — ${fields.business}`;
  const text = [
    "New Desk access request",
    "",
    `Name: ${fields.name}`,
    `Business: ${fields.business}`,
    `Phone: ${fields.phone}`,
    `Email: ${fields.email}`,
    "",
    "What they do:",
    fields.about,
    "",
    "Review in Super Admin when ADMIN_V2 is on.",
  ].join("\n");

  await sendOwnerEmail({ to, subject, text });
}
