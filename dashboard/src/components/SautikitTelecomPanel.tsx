import { adminTdClass, adminThClass } from "@/components/AdminIdentityList";
import {
  formatMinor,
  getSautikitKeyDiagnostics,
  getSautikitWallet,
  isSautikitConfigured,
  listSautikitNumbers,
} from "@/lib/sautikit";

function DiagnosticsBlock() {
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
    <div className="mt-4">
      <h3 className="text-title font-medium text-ink">Key</h3>
      <dl className="mt-2">
        {rows.map(([label, value]) => (
          <div key={label} className="flex min-w-0 items-baseline gap-3 border-t border-line/70 py-3 first:border-t-0">
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
      <p className="border-t border-line/70 py-3 text-meta text-ink-2">
        Expected: label like Key A / sauti-platform-read, scopes include wallet.read and numbers.read, length ~454, starts with eyJ.
      </p>
    </div>
  );
}

/** Server component: platform telecom costs straight from the SautiKit API. */
export async function SautikitTelecomPanel() {
  if (!isSautikitConfigured()) {
    return (
      <section className="border-t border-line/70 pt-6">
        <h2 className="text-title font-medium text-ink">Telecom (SautiKit)</h2>
        <p className="mt-2 text-sm text-ink-2">
          Set <code>SAUTIKIT_API_KEY</code> on the dashboard server (Vercel Production) to see
          your numbers, line costs, and wallet here.
        </p>
        <DiagnosticsBlock />
      </section>
    );
  }

  let numbers;
  let wallet = null;
  try {
    [numbers, wallet] = await Promise.all([listSautikitNumbers(), getSautikitWallet()]);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const code = (err as { code?: string }).code;
    return (
      <section className="border-t border-attention/40 pt-6">
        <h2 className="text-title font-medium text-ink">Telecom (SautiKit)</h2>
        <p className="mt-2 text-sm text-attention">Could not reach SautiKit: {message}</p>
        {code === "api_key.revoked" || /revoked/i.test(message) ? (
          <p className="mt-2 text-sm text-ink-2">
            Vercel is still sending a <span className="font-medium text-ink">revoked</span> key. In Vercel → Settings →
            Environment Variables, open <code>SAUTIKIT_API_KEY</code> for{" "}
            <span className="font-medium text-ink">Production</span>, paste only the JWT (starts with <code>eyJ</code>),
            save, then Redeploy the Production deployment.
          </p>
        ) : null}
        {code === "api_key.invalid" || /invalid|malformed/i.test(message) ? (
          <p className="mt-2 text-sm text-ink-2">
            The value looks malformed (often pasted as <code>SAUTIKIT_API_KEY=eyJ…</code> or with quotes). Value must
            be the bare JWT only.
          </p>
        ) : null}
        <DiagnosticsBlock />
      </section>
    );
  }

  const monthlyMinor = numbers.reduce(
    (sum, n) => (n.status === "active" ? sum + (n.monthly_retail_minor || 0) : sum),
    0,
  );
  const currency = numbers[0]?.currency || "KES";
  const freeInbound = numbers.every((n) => (n.inbound_per_min_minor || 0) === 0);

  return (
    <section className="border-t border-line/70 pt-6">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="text-title font-medium text-ink">Telecom (SautiKit)</h2>
        <p className="text-meta text-ink-2">
          Line rental / month{" "}
          <span className="text-sm font-medium tabular-nums text-ink">{formatMinor(monthlyMinor, currency)}</span>
        </p>
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
                    <td className={`${adminTdClass} whitespace-nowrap font-medium tabular-nums`}>{n.e164}</td>
                    <td className={adminTdClass}>{n.status}</td>
                    <td className={`${adminTdClass} whitespace-nowrap tabular-nums`}>
                      {formatMinor(n.monthly_retail_minor, n.currency)}
                    </td>
                    <td className={`${adminTdClass} whitespace-nowrap tabular-nums`}>
                      {n.inbound_per_min_minor === 0 ? "Free" : formatMinor(n.inbound_per_min_minor, n.currency)}
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

      <div className="mt-3 flex flex-wrap items-center gap-4 border-t border-line/70 py-3 text-meta text-ink-2">
        {freeInbound ? <span>Inbound minutes are free on this account.</span> : null}
        {wallet ? (
          <span>
            SautiKit wallet:{" "}
            <span className="font-medium tabular-nums text-ink">
              {formatMinor(wallet.balance_minor, wallet.currency)}
            </span>
          </span>
        ) : (
          <span>
            Wallet balance hidden. Mint an API key with the <code>wallet.read</code> scope to show it here.
          </span>
        )}
      </div>
    </section>
  );
}
