import { normalizeOpsEmail } from "@/lib/platformOpsModel";

function opsFromAddress(): string {
  return String(process.env.OPS_EMAIL_FROM || "").trim();
}

export function isOpsMailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY && opsFromAddress());
}

export async function sendOpsMail(opts: {
  to: string[];
  subject: string;
  text: string;
}): Promise<{ sent: number; skipped: string }> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = opsFromAddress();
  const to = opts.to.map(normalizeOpsEmail).filter(Boolean);
  if (!apiKey || !from) return { sent: 0, skipped: "ops_mail_unconfigured" };
  if (!to.length) return { sent: 0, skipped: "no_recipients" };

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to,
      subject: opts.subject,
      text: opts.text,
    }),
  });
  const json = (await res.json().catch(() => ({}))) as { message?: string };
  if (!res.ok) {
    throw new Error(json.message || `Ops mail failed (${res.status})`);
  }
  return { sent: to.length, skipped: "" };
}
