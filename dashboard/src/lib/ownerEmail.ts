function normalizeEmail(raw: string): string {
  const e = String(raw || "").trim().toLowerCase();
  if (!e || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return "";
  return e;
}

export function isOwnerEmailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY && process.env.ALERT_EMAIL_FROM);
}

export type SendOwnerEmailInput = {
  to: string;
  subject: string;
  text: string;
};

/** Resend HTTP API — same provider as the voice notify fallback. */
export async function sendOwnerEmail({ to, subject, text }: SendOwnerEmailInput): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.ALERT_EMAIL_FROM;
  if (!apiKey || !from) return;

  const dest = normalizeEmail(to);
  if (!dest) return;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from, to: [dest], subject, text }),
  });

  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    console.error(
      "[ownerEmail] Resend failed:",
      res.status,
      json?.message || JSON.stringify(json).slice(0, 200)
    );
  }
}
