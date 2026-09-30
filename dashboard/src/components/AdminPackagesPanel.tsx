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
import { assignmentFromBusiness, packagePriceLabel } from "@/lib/packagePriceLabel";

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
  const opening = assignmentFromBusiness(businesses[0]);
  const [businessId, setBusinessId] = useState(businesses[0]?.tenantId || "");
  const [packageId, setPackageId] = useState(opening.packageId || initialPackages[0]?.id || "");
  const [period, setPeriod] = useState<"month" | "year">(opening.period || "month");
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const inboundMin = inboundKesPerMinute(rates.inboundKesPerSecond);
  const outboundMin = outboundKesPerMinute(rates.outboundKesPerSecond);

  const selected = useMemo(
    () => businesses.find((row) => row.tenantId === businessId) || null,
    [businesses, businessId]
  );

  function selectBusiness(id: string) {
    setBusinessId(id);
    const next = assignmentFromBusiness(businesses.find((row) => row.tenantId === id));
    if (next.packageId) setPackageId(next.packageId);
    if (next.period) setPeriod(next.period);
  }

  function patchPack(index: number, patch: Partial<BillingPackage>) {
    setPacks((current) => current.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

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

      <section className="rounded-2xl border border-line bg-surface p-5">
        <h2 className="font-display text-xl tracking-tight text-ink">Landing</h2>
        {packs.some((pack) => pack.isActive) ? (
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            {packs
              .filter((pack) => pack.isActive)
              .map((pack) => (
                <article key={pack.id} className="rounded-xl border border-line bg-canvas p-4">
                  <h3 className="font-display text-title text-ink">{pack.name}</h3>
                  <p className="mt-3 font-display text-page tabular-nums text-ink">
                    {packagePriceLabel(pack.monthlyPriceKes)}
                  </p>
                  <p className="text-meta text-ink-soft">Per month</p>
                  <p className="mt-3 text-title tabular-nums text-ink">
                    {packagePriceLabel(annualPriceKes(pack.monthlyPriceKes, rates.annualDiscountPercent))}
                  </p>
                  <p className="text-meta text-ink-soft">Per year</p>
                  <p className="mt-3 text-body tabular-nums text-ink">
                    {pack.minutes.toLocaleString("en-KE")} min
                  </p>
                </article>
              ))}
          </div>
        ) : (
          <p className="mt-4 text-sm text-ink-soft">None live.</p>
        )}
      </section>

      <section className="space-y-4">
        <h2 className="font-display text-xl tracking-tight text-ink">Packages</h2>
        {packs.map((pack, index) => (
          <form
            key={pack.id}
            className="rounded-2xl border border-line bg-surface p-5"
            onSubmit={(event) => {
              event.preventDefault();
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
              );
            }}
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block text-sm">
                <span className="font-medium text-ink">Name</span>
                <input
                  className={`mt-2 ${fieldClass()}`}
                  value={pack.name}
                  onChange={(e) => patchPack(index, { name: e.target.value })}
                />
              </label>
              <label className="block text-sm">
                <span className="font-medium text-ink">Monthly KES</span>
                <input
                  className={`mt-2 ${fieldClass()}`}
                  type="number"
                  min={0}
                  value={pack.monthlyPriceKes}
                  onChange={(e) => patchPack(index, { monthlyPriceKes: Number(e.target.value) })}
                />
              </label>
            </div>
            <p className="mt-3 text-sm tabular-nums text-ink-soft">
              Per year {packagePriceLabel(annualPriceKes(pack.monthlyPriceKes, rates.annualDiscountPercent))}
            </p>
            <div className="mt-4 grid gap-4 sm:grid-cols-3">
              {(
                [
                  ["Seats", "seats", pack.seats],
                  ["Minutes", "minutes", pack.minutes],
                  ["SMS", "sms", pack.sms],
                  ["Email", "email", pack.email],
                  ["WhatsApp", "staffWa", pack.staffWa],
                  ["Number", "dids", pack.dids],
                ] as const
              ).map(([label, key, value]) => (
                <label key={key} className="block text-sm">
                  <span className="font-medium text-ink">{label}</span>
                  <input
                    className={`mt-2 ${fieldClass()}`}
                    type="number"
                    min={0}
                    value={value}
                    onChange={(e) => patchPack(index, { [key]: Number(e.target.value) })}
                  />
                </label>
              ))}
            </div>
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <label className="inline-flex min-h-11 items-center gap-3 text-sm font-medium text-ink">
                <input
                  type="checkbox"
                  className="h-5 w-5"
                  checked={pack.isActive}
                  onChange={(e) => patchPack(index, { isActive: e.target.checked })}
                  aria-label={`${pack.name} live on landing`}
                />
                Live
              </label>
              <button type="submit" disabled={pending} className={btnPrimary}>
                Save
              </button>
            </div>
          </form>
        ))}
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
              onChange={(e) => selectBusiness(e.target.value)}
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
            <p className="mb-3 text-sm text-ink">
              {selected?.packageName
                ? `Now ${selected.packageName}${selected.period ? ` / ${selected.period}` : ""}`
                : "Now none"}
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
