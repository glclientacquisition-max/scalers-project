import { sendOwnerEmail, isOwnerEmailConfigured } from "@/lib/ownerEmail";

export async function sendAccessRequestDeclineEmail(
  to: string,
  name: string,
  business: string,
  reason?: string | null
): Promise<boolean> {
  if (!isOwnerEmailConfigured()) return false;

  const greeting = name.trim() ? `Hi ${name.trim()},` : "Hi,";
  const reasonLine = reason?.trim()
    ? `We are not able to offer access right now. ${reason.trim()}`
    : "We are not able to offer access right now.";

  const text = [
    greeting,
    "",
    `Thanks for your interest in Scalers Desk for ${business.trim() || "your business"}.`,
    reasonLine,
    "",
    "If your situation changes, you can request access again from our website.",
    "",
    "Scalers",
  ].join("\n");

  await sendOwnerEmail({
    to,
    subject: "Your Scalers access request",
    text,
  });
  return true;
}
