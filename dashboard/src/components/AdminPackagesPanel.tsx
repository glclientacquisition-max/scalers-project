"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { btnPrimary, deskFieldClass } from "@/components/ui/deskChrome";
import {
  annualPriceKes,
  inboundKesPerMinute,
  kesPerSecondFromMinute,
  outboundKesPerMinute,
  type BillingPackage,
  type BillingRateCard,
  type TenantSubscriptionRow,
} from "@/lib/packageCatalog";

function fieldClass() {
  return deskFieldClass;
}

export function AdminPackagesPanel({
  rates: initialRates,
  packages: initialPackages,
  businesses,
}: {
  rates: BillingRateCard;
  packages: BillingPackage[];
  businesses: TenantSubscriptionRow[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [rates, setRates] = useState(initialRates);
  const [packs, setPacks] = useState(initialPackages);
  const [businessId, setBusinessId] = useState(businesses[0]?.tenantId || "");
  const [packageId, setPackageId] = useState(initialPackages[0]?.id || "");
  const [period, setPeriod] = useState<"month" | "year">("month");
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const inboundMin = inboundKesPerMinute(rates.inboundKesPerSecond);
  const outboundMin = outboundKesPerMinute(rates.outboundKesPerSecond);

  const selected = useMemo(
    () => businesses.find((row) => row.tenantId === businessId) || null,
    [businesses, businessId]
  );

  async function post(body: Record<string, unknown>, okText: string) {
    setError(null);
    setStatus(null);
    const res = await fetch("/api/admin/packages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) {
      setError(json.error || "Could not save.");
      return;
    }
    setStatus(okText);
    startTransition(() => router.refresh());
  }

  return (
    <div className="space-y-8">
      {error ? (
        <p className="text-sm text-warn" role="alert">
          {error}
        </p>
      ) : null}
      {status ? (
        <p className="text-sm text-ok" role="status">
          {status}
        </p>
      ) : null}

      <section className="rounded-2xl border border-line bg-surface p-5">
        <h2 className="font-display text-xl tracking-tight text-ink">On-demand rates</h2>
        <form
          className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
          onSubmit={(event) => {
            event.preventDefault();
            void post(
              {
                action: "save_rates",
                inbound_kes_per_second: rates.inboundKesPerSecond,
                outbound_kes_per_second: rates.outboundKesPerSecond,
                whatsapp_kes: rates.whatsappKes,
                sms_kes: rates.smsKes,
                email_kes: rates.emailKes,
                annual_discount_percent: rates.annualDiscountPercent,
              },
              "Rates saved."
            );
          }}
        >
          <label className="block text-sm">
            <span className="font-medium text-ink">Inbound KES / min</span>
            <input
              className={`mt-2 ${fieldClass()}`}
              type="number"
              min={0}
              step="0.01"
              value={inboundMin}
              onChange={(e) =>
                setRates({
                  ...rates,
                  inboundKesPerSecond: kesPerSecondFromMinute(Number(e.target.value)),
                })
              }
            />
            <span className="mt-1 block text-xs text-ink-soft">
              KES {rates.inboundKesPerSecond}/sec
            </span>
          </label>
          <label className="block text-sm">
            <span className="font-medium text-ink">Outbound KES / min</span>
            <input
              className={`mt-2 ${fieldClass()}`}
              type="number"
              min={0}
              step="0.01"
              value={outboundMin}
              onChange={(e) =>
                setRates({
                  ...rates,
                  outboundKesPerSecond: kesPerSecondFromMinute(Number(e.target.value)),
                })
              }
            />
            <span className="mt-1 block text-xs text-ink-soft">
              KES {rates.outboundKesPerSecond}/sec
            </span>
          </label>
          <label className="block text-sm">
            <span className="font-medium text-ink">WhatsApp KES</span>
            <input
              className={`mt-2 ${fieldClass()}`}
              type="number"
              min={0}
              step="0.01"
              value={rates.whatsappKes}
              onChange={(e) => setRates({ ...rates, whatsappKes: Number(e.target.value) })}
            />
          </label>
          <label className="block text-sm">
            <span className="font-medium text-ink">SMS KES / segment</span>
            <input
              className={`mt-2 ${fieldClass()}`}
              type="number"
              min={0}
              step="0.01"
              value={rates.smsKes}
              onChange={(e) => setRates({ ...rates, smsKes: Number(e.target.value) })}
            />
          </label>
          <label className="block text-sm">
            <span className="font-medium text-ink">Email KES</span>
            <input
              className={`mt-2 ${fieldClass()}`}
              type="number"
              min={0}
              step="0.01"
              value={rates.emailKes}
              onChange={(e) => setRates({ ...rates, emailKes: Number(e.target.value) })}
            />
          </label>
          <label className="block text-sm">
            <span className="font-medium text-ink">Annual discount %</span>
            <input
              className={`mt-2 ${fieldClass()}`}
              type="number"
              min={0}
              max={100}
              step="0.01"
              value={rates.annualDiscountPercent}
              onChange={(e) =>
                setRates({ ...rates, annualDiscountPercent: Number(e.target.value) })
              }
            />
          </label>
          <div className="sm:col-span-2 lg:col-span-3">
            <button type="submit" disabled={pending} className={btnPrimary}>
              Save rates
            </button>
          </div>
        </form>
      </section>

      <section className="overflow-x-auto rounded-2xl border border-line bg-surface">
        <h2 className="px-5 pt-5 font-display text-xl tracking-tight text-ink">Packages</h2>
        <table className="mt-3 w-full min-w-[720px] text-left text-sm">
          <thead className="border-b border-line text-ink-soft">
            <tr>
              <th className="px-4 py-2">Name</th>
              <th className="px-4 py-2">Monthly</th>
              <th className="px-4 py-2">Annual</th>
              <th className="px-4 py-2">Seats</th>
              <th className="px-4 py-2">Min</th>
              <th className="px-4 py-2">SMS</th>
              <th className="px-4 py-2">Email</th>
              <th className="px-4 py-2">WA</th>
              <th className="px-4 py-2">DID</th>
              <th className="px-4 py-2">On</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody>
            {packs.map((pack, index) => (
              <tr key={pack.id} className="border-t border-line/70">
                <td className="px-4 py-2">
                  <input
                    className={fieldClass()}
                    value={pack.name}
                    onChange={(e) => {
                      const next = [...packs];
                      next[index] = { ...pack, name: e.target.value };
                      setPacks(next);
                    }}
                  />
                </td>
                <td className="px-4 py-2">
                  <input
                    className={fieldClass()}
                    type="number"
                    min={0}
                    value={pack.monthlyPriceKes}
                    onChange={(e) => {
                      const next = [...packs];
                      next[index] = { ...pack, monthlyPriceKes: Number(e.target.value) };
                      setPacks(next);
                    }}
                  />
                </td>
                <td className="px-4 py-2 tabular-nums text-ink-soft">
                  {annualPriceKes(pack.monthlyPriceKes, rates.annualDiscountPercent).toLocaleString(
                    "en-KE"
                  )}
                </td>
                {(
                  [
                    ["seats", pack.seats],
                    ["minutes", pack.minutes],
                    ["sms", pack.sms],
                    ["email", pack.email],
                    ["staffWa", pack.staffWa],
                    ["dids", pack.dids],
                  ] as const
                ).map(([key, value]) => (
                  <td key={key} className="px-4 py-2">
                    <input
                      className={fieldClass()}
                      type="number"
                      min={0}
                      value={value}
                      onChange={(e) => {
                        const next = [...packs];
                        next[index] = { ...pack, [key]: Number(e.target.value) };
                        setPacks(next);
                      }}
                    />
                  </td>
                ))}
                <td className="px-4 py-2">
                  <label className="inline-flex h-11 w-11 items-center justify-center">
                    <input
                      type="checkbox"
                      className="h-5 w-5"
                      checked={pack.isActive}
                      onChange={(e) => {
                        const next = [...packs];
                        next[index] = { ...pack, isActive: e.target.checked };
                        setPacks(next);
                      }}
                      aria-label={`${pack.name} on`}
                    />
                  </label>
                </td>
                <td className="px-4 py-2">
                  <button
                    type="button"
                    disabled={pending}
                    className={btnPrimary}
                    onClick={() =>
                      void post(
                        {
                          action: "save_package",
                          id: pack.id,
                          sku: pack.sku,
                          name: pack.name,
                          monthly_price_kes: pack.monthlyPriceKes,
                          seats: pack.seats,
                          minutes: pack.minutes,
                          sms: pack.sms,
                          email: pack.email,
                          staff_wa: pack.staffWa,
                          dids: pack.dids,
                          sort_order: pack.sortOrder,
                          is_active: pack.isActive,
                        },
                        `${pack.name} saved.`
                      )
                    }
                  >
                    Save
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="overflow-x-auto rounded-2xl border border-line bg-surface">
        <h2 className="px-5 pt-5 font-display text-xl tracking-tight text-ink">Businesses</h2>
        {businesses.length === 0 ? (
          <p className="px-5 py-6 text-sm text-ink-soft">No businesses.</p>
        ) : (
          <table className="mt-3 w-full min-w-[520px] text-left text-sm">
            <thead className="border-b border-line text-ink-soft">
              <tr>
                <th className="px-4 py-2">Business</th>
                <th className="px-4 py-2">Package</th>
                <th className="px-4 py-2">Period</th>
              </tr>
            </thead>
            <tbody>
              {businesses.map((row) => (
                <tr key={row.tenantId} className="border-t border-line/70">
                  <td className="px-4 py-2 font-medium text-ink">{row.businessName}</td>
                  <td className="px-4 py-2 text-ink-soft">{row.packageName || "None"}</td>
                  <td className="px-4 py-2 text-ink-soft">{row.period || "None"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="rounded-2xl border border-line bg-surface p-5">
        <h2 className="font-display text-xl tracking-tight text-ink">Assign</h2>
        <form
          className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4"
          onSubmit={(event) => {
            event.preventDefault();
            void post(
              {
                action: "assign",
                business_id: businessId,
                package_id: packageId,
                period,
              },
              "Package assigned."
            );
          }}
        >
          <label className="block text-sm sm:col-span-2">
            <span className="font-medium text-ink">Business</span>
            <select
              className={`mt-2 ${fieldClass()}`}
              value={businessId}
              onChange={(e) => setBusinessId(e.target.value)}
            >
              {businesses.map((row) => (
                <option key={row.tenantId} value={row.tenantId}>
                  {row.businessName}
                  {row.packageName ? ` (${row.packageName})` : ""}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            <span className="font-medium text-ink">Package</span>
            <select
              className={`mt-2 ${fieldClass()}`}
              value={packageId}
              onChange={(e) => setPackageId(e.target.value)}
            >
              {packs.filter((pack) => pack.isActive || pack.id === packageId).map((pack) => (
                <option key={pack.id} value={pack.id}>
                  {pack.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            <span className="font-medium text-ink">Period</span>
            <select
              className={`mt-2 ${fieldClass()}`}
              value={period}
              onChange={(e) => setPeriod(e.target.value as "month" | "year")}
            >
              <option value="month">Month</option>
              <option value="year">Year</option>
            </select>
          </label>
          <div className="sm:col-span-2 lg:col-span-4">
            <p className="mb-3 text-sm text-ink-soft">
              {selected?.packageName
                ? `${selected.packageName}${selected.period ? ` / ${selected.period}` : ""}`
                : "None"}
            </p>
            <button type="submit" disabled={pending || !businessId || !packageId} className={btnPrimary}>
              Assign
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
