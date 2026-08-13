import {
  formatMinor,
  getSautikitKeyDiagnostics,
  getSautikitWallet,
  isSautikitConfigured,
  listSautikitNumbers,
} from "@/lib/sautikit";

function DiagnosticsBlock() {
  const d = getSautikitKeyDiagnostics();
  return (
    <div className="mt-3 rounded-xl border border-[var(--line)] bg-white/70 px-4 py-3 text-xs text-[var(--ink-soft)] space-y-1">
      <p className="font-medium text-[var(--ink)]">Key loaded on this server (safe diagnostics)</p>
      <p>
        Configured: {d.configured ? "yes" : "no"}
        {d.fingerprint ? ` · fingerprint ${d.fingerprint}` : ""}
        {d.length ? ` · length ${d.length}` : ""}
      </p>
      <p>
        Starts with eyJ: {d.startsWithEyJ ? "yes" : "no"}
        {d.label ? ` · label “${d.label}”` : ""}
      </p>
      <p>Scopes: {d.scopes.length ? d.scopes.join(", ") : "n/a"}</p>
      <p>Workspace: {d.workspaceId || "n/a"}</p>
      {d.issues.length ? (
        <ul className="mt-2 list-disc pl-4 text-[var(--warn)]">
          {d.issues.map((issue) => (
            <li key={issue}>{issue}</li>
          ))}
        </ul>
      ) : null}
      <p className="mt-2">
        Expected: label like Key A / sauti-platform-read, scopes include wallet.read +
        numbers.read, length ~454, starts with eyJ.
      </p>
    </div>
  );
}

/** Server component: platform telecom costs straight from the SautiKit API. */
export async function SautikitTelecomPanel() {
  if (!isSautikitConfigured()) {
    return (
      <section className="rounded-2xl border border-[var(--line)] bg-[var(--card)] p-6">
        <h2 className="font-display text-2xl tracking-tight">Telecom (SautiKit)</h2>
        <p className="mt-2 text-sm text-[var(--ink-soft)]">
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
      <section className="rounded-2xl border border-[var(--warn)]/40 bg-white p-6">
        <h2 className="font-display text-2xl tracking-tight">Telecom (SautiKit)</h2>
        <p className="mt-2 text-sm text-[var(--warn)]">Could not reach SautiKit: {message}</p>
        {code === "api_key.revoked" || /revoked/i.test(message) ? (
          <p className="mt-2 text-sm text-[var(--ink-soft)]">
            Vercel is still sending a <strong>revoked</strong> key. In Vercel → Settings →
            Environment Variables, open <code>SAUTIKIT_API_KEY</code> for{" "}
            <strong>Production</strong>, paste only the JWT (starts with <code>eyJ</code>),
            save, then Redeploy the Production deployment.
          </p>
        ) : null}
        {code === "api_key.invalid" || /invalid|malformed/i.test(message) ? (
          <p className="mt-2 text-sm text-[var(--ink-soft)]">
            The value looks malformed (often pasted as <code>SAUTIKIT_API_KEY=eyJ…</code> or
            with quotes). Value must be the bare JWT only.
          </p>
        ) : null}
        <DiagnosticsBlock />
      </section>
    );
  }

  const monthlyMinor = numbers.reduce(
    (sum, n) => (n.status === "active" ? sum + (n.monthly_retail_minor || 0) : sum),
    0
  );
  const currency = numbers[0]?.currency || "KES";
  const freeInbound = numbers.every((n) => (n.inbound_per_min_minor || 0) === 0);

  return (
    <section className="rounded-2xl border border-[var(--line)] bg-[var(--card)] p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-display text-2xl tracking-tight">Telecom (SautiKit)</h2>
          <p className="mt-1 text-sm text-[var(--ink-soft)]">
            Live from your SautiKit account. This is what the platform pays.
          </p>
        </div>
        <div className="text-right">
          <p className="text-xs uppercase tracking-wide text-[var(--ink-soft)]">
            Line rental / month
          </p>
          <p className="font-display text-2xl text-[var(--ink)]">
            {formatMinor(monthlyMinor, currency)}
          </p>
        </div>
      </div>

      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="text-[var(--ink-soft)]">
            <tr className="border-b border-[var(--line)]/70">
              <th className="py-2 pr-4 font-medium">Number</th>
              <th className="py-2 pr-4 font-medium">Status</th>
              <th className="py-2 pr-4 font-medium">Monthly</th>
              <th className="py-2 pr-4 font-medium">Inbound / min</th>
              <th className="py-2 pr-4 font-medium">Capabilities</th>
              <th className="py-2 font-medium">Voice webhook</th>
            </tr>
          </thead>
          <tbody>
            {numbers.map((n) => {
              const webhookOk = Boolean(n.voice_callback_url);
              return (
                <tr key={n.id} className="border-b border-[var(--line)]/40 last:border-0">
                  <td className="py-2.5 pr-4 font-medium whitespace-nowrap">{n.e164}</td>
                  <td className="py-2.5 pr-4">
                    <span
                      className={[
                        "rounded-full px-2 py-0.5 text-xs",
                        n.status === "active"
                          ? "bg-[var(--ok)]/10 text-[var(--ok)]"
                          : "bg-[var(--bg-deep)] text-[var(--ink-soft)]",
                      ].join(" ")}
                    >
                      {n.status}
                    </span>
                  </td>
                  <td className="py-2.5 pr-4 whitespace-nowrap">
                    {formatMinor(n.monthly_retail_minor, n.currency)}
                  </td>
                  <td className="py-2.5 pr-4 whitespace-nowrap">
                    {n.inbound_per_min_minor === 0
                      ? "Free"
                      : formatMinor(n.inbound_per_min_minor, n.currency)}
                  </td>
                  <td className="py-2.5 pr-4">{(n.capabilities || []).join(", ")}</td>
                  <td className="py-2.5">
                    <span
                      className={[
                        "text-xs",
                        webhookOk ? "text-[var(--ok)]" : "text-[var(--warn)]",
                      ].join(" ")}
                      title={n.voice_callback_url || "No voice callback URL set"}
                    >
                      {webhookOk ? "connected" : "not set"}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-4 text-xs text-[var(--ink-soft)]">
        {freeInbound ? <span>Inbound minutes are free on this account.</span> : null}
        {wallet ? (
          <span>
            SautiKit wallet:{" "}
            <span className="font-medium text-[var(--ink)]">
              {formatMinor(wallet.balance_minor, wallet.currency)}
            </span>
          </span>
        ) : (
          <span>
            Wallet balance hidden. Mint an API key with the <code>wallet.read</code> scope to
            show it here.
          </span>
        )}
      </div>
    </section>
  );
}
