import {
  OPS_RESEND_DOMAIN,
  normalizeOpsEmail,
  normalizeResendRecords,
  type OpsDnsRecord,
} from "@/lib/platformOpsModel";

export { OPS_RESEND_DOMAIN, normalizeResendRecords };
export type { OpsDnsRecord };

export type OpsResendDomain = {
  configured: boolean;
  domain: string;
  status: string;
  records: OpsDnsRecord[];
  message: string;
};

function opsFromAddress(): string {
  return String(process.env.OPS_EMAIL_FROM || "").trim();
}

function resendKey(): string {
  return String(process.env.RESEND_API_KEY || "").trim();
}

export function isOpsMailConfigured(): boolean {
  return Boolean(resendKey() && opsFromAddress());
}

export function normalizeResendRecords(raw: unknown): OpsDnsRecord[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((row) => {
    if (!row || typeof row !== "object") return [];
    const rec = row as Record<string, unknown>;
    const type = String(rec.type || "").toUpperCase();
    const value = String(rec.value || rec.content || "").trim();
    if (!type || !value) return [];
    const priorityRaw = rec.priority;
    const priority =
      typeof priorityRaw === "number" && Number.isFinite(priorityRaw) ? priorityRaw : null;
    return [
      {
        name: String(rec.name || "").trim() || OPS_RESEND_DOMAIN,
        type,
        value,
        priority,
        status: String(rec.status || "").trim() || "pending",
      },
    ];
  });
}

async function resendJson(
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<{ ok: boolean; status: number; json: Record<string, unknown> }> {
  const apiKey = resendKey();
  if (!apiKey) return { ok: false, status: 0, json: { message: "RESEND_API_KEY is not set." } };
  const res = await fetch(`https://api.resend.com${path}`, {
    method: init.method || "GET",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: res.ok, status: res.status, json };
}

function domainFromRow(row: Record<string, unknown> | null): OpsResendDomain {
  if (!row) {
    return {
      configured: Boolean(resendKey()),
      domain: OPS_RESEND_DOMAIN,
      status: resendKey() ? "missing" : "no_key",
      records: [],
      message: resendKey()
        ? "Create the Resend domain, then add the DNS records on scalers.co.ke."
        : "Set RESEND_API_KEY on the desk to create ops.scalers.co.ke.",
    };
  }
  const status = String(row.status || "pending");
  return {
    configured: Boolean(resendKey()),
    domain: String(row.name || OPS_RESEND_DOMAIN),
    status,
    records: normalizeResendRecords(row.records),
    message:
      status === "verified"
        ? "ops.scalers.co.ke is verified."
        : "Add these records on scalers.co.ke, then check DNS.",
  };
}

export async function getOpsResendDomain(): Promise<OpsResendDomain> {
  if (!resendKey()) return domainFromRow(null);
  const listed = await resendJson("/domains");
  if (!listed.ok) {
    return {
      configured: true,
      domain: OPS_RESEND_DOMAIN,
      status: "error",
      records: [],
      message: String(listed.json.message || `Resend list failed (${listed.status})`),
    };
  }
  const rows = Array.isArray(listed.json.data) ? listed.json.data : [];
  const found = rows.find(
    (row) =>
      row &&
      typeof row === "object" &&
      String((row as Record<string, unknown>).name || "").toLowerCase() === OPS_RESEND_DOMAIN,
  ) as Record<string, unknown> | undefined;
  if (!found?.id) return domainFromRow(null);
  const detail = await resendJson(`/domains/${found.id}`);
  if (detail.ok) return domainFromRow(detail.json);
  return domainFromRow(found);
}

export async function ensureOpsResendDomain(): Promise<OpsResendDomain> {
  const current = await getOpsResendDomain();
  if (!current.configured) return current;
  if (current.status !== "missing") return current;
  const created = await resendJson("/domains", {
    method: "POST",
    body: { name: OPS_RESEND_DOMAIN },
  });
  if (!created.ok) {
    return {
      ...current,
      status: "error",
      message: String(created.json.message || `Resend create failed (${created.status})`),
    };
  }
  return domainFromRow(created.json);
}

export async function verifyOpsResendDomain(): Promise<OpsResendDomain> {
  const current = await getOpsResendDomain();
  const listed = await resendJson("/domains");
  const rows = listed.ok && Array.isArray(listed.json.data) ? listed.json.data : [];
  const found = rows.find(
    (row) =>
      row &&
      typeof row === "object" &&
      String((row as Record<string, unknown>).name || "").toLowerCase() === OPS_RESEND_DOMAIN,
  ) as Record<string, unknown> | undefined;
  if (!found?.id) return current;
  await resendJson(`/domains/${found.id}/verify`, { method: "POST" });
  return getOpsResendDomain();
}

export async function sendOpsMail(opts: {
  to: string[];
  subject: string;
  text: string;
}): Promise<{ sent: number; skipped: string }> {
  const apiKey = resendKey();
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
