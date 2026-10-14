import { fetchVoiceHealthz, type SmsCreditHealth } from "@/lib/platformVoiceHealth";

const STATE_LABEL: Record<string, string> = {
  ok: "OK",
  warn: "Low",
  critical: "Critical",
  exhausted: "Out of credit",
  unknown: "Unknown",
};

export function formatSmsCheckedAt(iso: string | null | undefined): string {
  if (!iso) return "never";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "never";
  return `${d.toLocaleString("en-GB", { timeZone: "Africa/Nairobi", dateStyle: "medium", timeStyle: "short" })} EAT`;
}

export function smsCreditRows(sms: SmsCreditHealth | undefined): Array<[string, string]> {
  if (!sms) return [["Status", "Voice health has no SMS block yet"]];
  return [
    ["Status", STATE_LABEL[sms.state || "unknown"] || "Unknown"],
    ["Balance", sms.balance != null ? `${sms.balance} units` : "n/a"],
    ["Runway", sms.runwayDays != null ? `~${sms.runwayDays} days` : "n/a"],
    ["Checked", formatSmsCheckedAt(sms.checkedAt)],
  ];
}

/** Server component: TextSMS credits (shared prod + staging account) from Voice /healthz. */
export async function SmsCreditPanel() {
  const health = await fetchVoiceHealthz();
  const rows =
    health.status === "ok"
      ? smsCreditRows(health.payload.sms)
      : ([["Status", `Voice health unavailable: ${health.message}`]] as Array<[string, string]>);
  const alert =
    health.status === "ok" &&
    ["warn", "critical", "exhausted"].includes(health.payload.sms?.state || "");
  return (
    <section className="border-t border-hairline/70 pt-6">
      <h2 className="text-title font-medium text-ink">SMS credits (TextSMS)</h2>
      <dl className="mt-2">
        {rows.map(([label, value]) => (
          <div key={label} className="flex min-w-0 items-baseline gap-3 border-t border-hairline/70 py-3 first:border-t-0">
            <dt className="w-36 shrink-0 text-meta text-ink-2">{label}</dt>
            <dd className={`min-w-0 text-body ${alert && label === "Status" ? "text-attention" : "text-ink"}`}>{value}</dd>
          </div>
        ))}
      </dl>
      <p className="border-t border-hairline/70 py-3 text-meta text-ink-2">
        One TextSMS account serves production and staging. Top up at TextSMS.
      </p>
    </section>
  );
}
