import {
  formatMinor,
  getSautikitWallet,
  isSautikitConfigured,
  listSautikitNumbers,
} from "@/lib/sautikit";

/** Server component: platform telecom costs straight from the SautiKit API. */
export async function SautikitTelecomPanel() {
  if (!isSautikitConfigured()) {
    return (
      <section className="rounded-2xl border border-[var(--line)] bg-[var(--card)] p-6">
        <h2 className="font-display text-2xl tracking-tight">Telecom (SautiKit)</h2>
        <p className="mt-2 text-sm text-[var(--ink-soft)]">
          Set <code>SAUTIKIT_API_KEY</code> on the dashboard server to see your numbers,
          line costs, and wallet here.
        </p>
      </section>
    );
  }

  let numbers;
  let wallet = null;
  try {
    [numbers, wallet] = await Promise.all([listSautikitNumbers(), getSautikitWallet()]);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return (
      <section className="rounded-2xl border border-[var(--warn)]/40 bg-white p-6">
        <h2 className="font-display text-2xl tracking-tight">Telecom (SautiKit)</h2>
        <p className="mt-2 text-sm text-[var(--warn)]">Could not reach SautiKit: {message}</p>
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
            Live from your SautiKit account — this is what the platform pays.
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
            Wallet balance hidden — mint an API key with the <code>wallet.read</code> scope to
            show it here.
          </span>
        )}
      </div>
    </section>
  );
}
