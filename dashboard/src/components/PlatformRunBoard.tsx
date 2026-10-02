import Link from "next/link";
import { adminTdClass, adminThClass } from "@/components/AdminIdentityList";
import { Stamp } from "@/components/ui/Stamp";
import { btnGhost } from "@/components/ui/deskChrome";
import {
  buildPlatformRunRows,
  type PhoneLineTelecomInput,
  type PlatformHealthTone,
} from "@/lib/platformRunBoardModel";
import { fetchVoiceHealthz } from "@/lib/platformVoiceHealth";
import {
  formatMinor,
  getSautikitKeyDiagnostics,
  getSautikitWallet,
  isSautikitConfigured,
  listSautikitNumbers,
} from "@/lib/sautikit";

function healthStampTone(tone: PlatformHealthTone): "ok" | "attention" | "neutral" {
  return tone;
}

function KeyDiagnostics() {
  const d = getSautikitKeyDiagnostics();
  const rows: Array<[string, string]> = [
    ["Configured", d.configured ? "yes" : "no"],
    ["Fingerprint", d.fingerprint || "n/a"],
    ["Length", d.length ? String(d.length) : "n/a"],
    ["Starts with eyJ", d.startsWithEyJ ? "yes" : "no"],
    ["Label", d.label || "n/a"],
    ["Scopes", d.scopes.length ? d.scopes.join(", ") : "n/a"],
    ["Workspace", d.workspaceId || "n/a"],
  ];

  return (
    <details className="mt-4 border-t border-line/70 pt-4">
      <summary className="cursor-pointer text-meta font-medium text-ink-2">Phone line API key</summary>
      <dl className="mt-2">
        {rows.map(([label, value]) => (
          <div
            key={label}
            className="flex min-w-0 items-baseline gap-3 border-t border-line/70 py-3 first:border-t-0"
          >
            <dt className="w-36 shrink-0 text-meta text-ink-2">{label}</dt>
            <dd className="min-w-0 text-sm text-ink">{value}</dd>
          </div>
        ))}
      </dl>
      {d.issues.length ? (
        <ul className="border-t border-line/70">
          {d.issues.map((issue) => (
            <li key={issue} className="border-t border-line/70 py-3 text-sm text-attention first:border-t-0">
              {issue}
            </li>
          ))}
        </ul>
      ) : null}
    </details>
  );
}

async function loadPhoneLineTelecom(): Promise<PhoneLineTelecomInput> {
  if (!isSautikitConfigured()) {
    return { status: "not_configured" };
  }

  try {
    const numbers = await listSautikitNumbers();
    let wallet = null;
    let walletHidden = false;
    try {
      wallet = await getSautikitWallet();
      if (!wallet) walletHidden = true;
    } catch {
      walletHidden = true;
    }
    return { status: "ok", numbers, wallet, walletHidden };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { status: "error", message };
  }
}

/** Server component: Platform health + money for ops on /admin. */
export async function PlatformRunBoard() {
  const [telecom, voice] = await Promise.all([loadPhoneLineTelecom(), fetchVoiceHealthz()]);
  const rows = buildPlatformRunRows({ telecom, voice });
  const numbers = telecom.status === "ok" ? telecom.numbers : [];
  const freeInbound = numbers.length > 0 && numbers.every((n) => (n.inbound_per_min_minor || 0) === 0);

  return (
    <section className="border-t border-line/70 pt-6" aria-label="Platform">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="text-title font-medium text-ink">Platform</h2>
        {voice.status === "ok" && voice.payload.gitSha ? (
          <p className="text-meta text-ink-3 tabular-nums">Voice {voice.payload.gitSha.slice(0, 7)}</p>
        ) : voice.status !== "ok" ? (
          <p className="text-meta text-attention">{voice.message}</p>
        ) : null}
      </div>
      <p className="mt-1 text-meta text-ink-2">Phone line, speech, and reasoning at a glance.</p>

      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[480px] text-left text-sm">
          <thead className="text-ink-2">
            <tr className="border-b border-line/70">
              <th className={adminThClass}>Line</th>
              <th className={adminThClass}>Health</th>
              <th className={adminThClass}>Money</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-t border-line/70 align-top">
                <td className={adminTdClass}>
                  <p className="font-medium text-ink">{row.title}</p>
                  <p className="text-meta text-ink-2">{row.subtitle}</p>
                </td>
                <td className={adminTdClass}>
                  <Stamp tone={healthStampTone(row.health.tone)}>{row.health.label}</Stamp>
                  {row.health.detail ? (
                    <p className="mt-2 max-w-md text-meta text-ink-2">{row.health.detail}</p>
                  ) : null}
                </td>
                <td className={`${adminTdClass} tabular-nums`}>
                  <p className="font-medium text-ink">{row.money.primary}</p>
                  {row.money.hint ? <p className="mt-1 text-meta text-ink-2">{row.money.hint}</p> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {telecom.status === "not_configured" ? (
        <p className="mt-4 text-sm text-ink-2">
          Set <code>SAUTIKIT_API_KEY</code> on the dashboard server to load phone line numbers and wallet.
        </p>
      ) : null}

      {telecom.status === "ok" ? (
        <div className="mt-6">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h3 className="text-title font-medium text-ink">Phone line numbers</h3>
            <Link href="/admin/numbers" className={btnGhost}>
              Manage numbers
            </Link>
          </div>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="text-ink-2">
                <tr className="border-b border-line/70">
                  <th className={adminThClass}>Number</th>
                  <th className={adminThClass}>Status</th>
                  <th className={adminThClass}>Monthly</th>
                  <th className={adminThClass}>Inbound / min</th>
                  <th className={adminThClass}>Capabilities</th>
                  <th className={adminThClass}>Voice webhook</th>
                </tr>
              </thead>
              <tbody>
                {numbers.length === 0 ? (
                  <tr>
                    <td className={adminTdClass} colSpan={6}>
                      No numbers.
                    </td>
                  </tr>
                ) : (
                  numbers.map((n) => {
                    const webhookOk = Boolean(n.voice_callback_url);
                    return (
                      <tr key={n.id} className="border-t border-line/70">
                        <td className={`${adminTdClass} whitespace-nowrap font-medium tabular-nums`}>
                          {n.e164}
                        </td>
                        <td className={adminTdClass}>{n.status}</td>
                        <td className={`${adminTdClass} whitespace-nowrap tabular-nums`}>
                          {formatMinor(n.monthly_retail_minor, n.currency)}
                        </td>
                        <td className={`${adminTdClass} whitespace-nowrap tabular-nums`}>
                          {n.inbound_per_min_minor === 0
                            ? "Free"
                            : formatMinor(n.inbound_per_min_minor, n.currency)}
                        </td>
                        <td className={adminTdClass}>{(n.capabilities || []).join(", ") || "n/a"}</td>
                        <td className={adminTdClass}>
                          <span
                            className={webhookOk ? "text-ok" : "text-attention"}
                            title={n.voice_callback_url || "No voice callback URL set"}
                          >
                            {webhookOk ? "connected" : "not set"}
                          </span>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
          {freeInbound ? (
            <p className="mt-3 text-meta text-ink-2">Inbound minutes are free on this account.</p>
          ) : null}
        </div>
      ) : null}

      <KeyDiagnostics />
    </section>
  );
}
