"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Segmented } from "@/components/ui/Segmented";
import { Empty } from "@/components/ui/Empty";
import {
  btnPrimary,
  deskFieldClass,
  deskPreviewCellClass,
  deskPreviewClass,
  tableCellClass,
  tableHeadCellClass,
} from "@/components/ui/deskChrome";
import {
  annualPriceKes,
  inboundKesPerMinute,
  kesPerSecondFromMinute,
  outboundKesPerMinute,
  type BillingPackage,
  type BillingRateCard,
  type TenantSubscriptionRow,
} from "@/lib/packageCatalog";
import { deskShiftClass } from "@/lib/deskMotion";
import { assignmentFromBusiness, packagePriceLabel } from "@/lib/packagePriceLabel";

type Walk = "rates" | "plans" | "assign";

const COUNT_FIELDS = [
  ["Seats", "seats"],
  ["Minutes", "minutes"],
  ["SMS", "sms"],
  ["Email", "email"],
  ["WhatsApp", "staffWa"],
  ["Number", "dids"],
] as const;

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
  const [walk, setWalk] = useState<Walk>("plans");
  const [rates, setRates] = useState(initialRates);
  const [packs, setPacks] = useState(initialPackages);
  const [planId, setPlanId] = useState(initialPackages[0]?.id || "");
  const opening = assignmentFromBusiness(businesses[0]);
  const [businessId, setBusinessId] = useState(businesses[0]?.tenantId || "");
  const [packageId, setPackageId] = useState(opening.packageId || initialPackages[0]?.id || "");
  const [period, setPeriod] = useState<"month" | "year">(opening.period || "month");
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const inboundMin = inboundKesPerMinute(rates.inboundKesPerSecond);
  const outboundMin = outboundKesPerMinute(rates.outboundKesPerSecond);
  const plan = packs.find((row) => row.id === planId) || packs[0] || null;
  const planIndex = plan ? packs.findIndex((row) => row.id === plan.id) : -1;

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
    <div className="space-y-6">
      <Segmented
        label="Packages"
        onSelect={(key) => {
          setWalk(key as Walk);
          setError(null);
          setStatus(null);
        }}
        items={[
          { key: "rates", label: "Rates", active: walk === "rates" },
          { key: "plans", label: "Plans", active: walk === "plans" },
          { key: "assign", label: "Assign", active: walk === "assign" },
        ]}
      />

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

      {walk === "rates" ? (
        <form
          className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
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
            <span className="mt-1 block text-xs text-ink-soft">KES {rates.inboundKesPerSecond}/sec</span>
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
              KES {rates.outboundKesPerSecond}/sec. Stored. Hidden until live transfer.
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
      ) : null}

      {walk === "plans" ? (
        packs.length === 0 ? (
          <Empty title="None live." />
        ) : (
          <div className="lg:grid lg:grid-cols-2 lg:items-start lg:gap-8">
            <div>
              <ul className="md:hidden">
                {packs.map((pack) => {
                  const on = plan?.id === pack.id;
                  return (
                    <li key={pack.id} className="border-b border-line">
                      <button
                        type="button"
                        aria-pressed={on}
                        onClick={() => setPlanId(pack.id)}
                        className={`flex min-h-11 w-full items-center gap-3 py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand ${
                          on ? "border-s-[3px] border-brand ps-3" : "ps-0"
                        }`}
                      >
                        <span className="min-w-0 flex-1">
                          <span className={`block font-medium text-ink ${deskPreviewClass}`}>{pack.name}</span>
                          <span className={`mt-0.5 block text-meta text-ink-soft ${deskPreviewClass}`}>
                            {pack.minutes.toLocaleString("en-KE")} min
                            {pack.isActive ? " · Live" : ""}
                          </span>
                        </span>
                        <span className="shrink-0 tabular-nums text-ink">
                          {packagePriceLabel(pack.monthlyPriceKes)}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
              <div className="hidden overflow-x-auto md:block">
                <table className="w-full text-left text-sm">
                  <caption className="sr-only">Plans</caption>
                  <thead className="border-b border-line text-ink-soft">
                    <tr>
                      <th className={tableHeadCellClass}>Package</th>
                      <th className={tableHeadCellClass}>Month</th>
                      <th className={tableHeadCellClass}>Year</th>
                      <th className={tableHeadCellClass}>Minutes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {packs.map((pack) => {
                      const on = plan?.id === pack.id;
                      return (
                        <tr
                          key={pack.id}
                          className={`border-b border-line ${on ? "bg-surface-2" : ""}`}
                        >
                          <td className={`${tableCellClass} ${deskPreviewCellClass}`}>
                            <button
                              type="button"
                              aria-pressed={on}
                              onClick={() => setPlanId(pack.id)}
                              className={`flex min-h-11 w-full items-center text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand ${
                                on ? "border-s-[3px] border-brand ps-2" : ""
                              }`}
                            >
                              <span className="min-w-0">
                                <span className={`block font-medium text-ink ${deskPreviewClass}`}>{pack.name}</span>
                                {pack.isActive ? (
                                  <span className="mt-0.5 block text-meta text-ink-soft">Live</span>
                                ) : null}
                              </span>
                            </button>
                          </td>
                          <td className={`${tableCellClass} tabular-nums text-ink`}>
                            {packagePriceLabel(pack.monthlyPriceKes)}
                          </td>
                          <td className={`${tableCellClass} tabular-nums text-ink`}>
                            {packagePriceLabel(annualPriceKes(pack.monthlyPriceKes, rates.annualDiscountPercent))}
                          </td>
                          <td className={`${tableCellClass} tabular-nums text-ink`}>
                            {pack.minutes.toLocaleString("en-KE")}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {plan && planIndex >= 0 ? (
              <form
                className="mt-6 lg:mt-0"
                onSubmit={(event) => {
                  event.preventDefault();
                  void post(
                    {
                      action: "save_package",
                      id: plan.id,
                      sku: plan.sku,
                      name: plan.name,
                      monthly_price_kes: plan.monthlyPriceKes,
                      seats: plan.seats,
                      minutes: plan.minutes,
                      sms: plan.sms,
                      email: plan.email,
                      staff_wa: plan.staffWa,
                      dids: plan.dids,
                      sort_order: plan.sortOrder,
                      is_active: plan.isActive,
                    },
                    `${plan.name} saved.`
                  );
                }}
              >
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="block text-sm">
                    <span className="font-medium text-ink">Name</span>
                    <input
                      className={`mt-2 ${fieldClass()}`}
                      value={plan.name}
                      onChange={(e) => patchPack(planIndex, { name: e.target.value })}
                    />
                  </label>
                  <label className="block text-sm">
                    <span className="font-medium text-ink">Monthly KES</span>
                    <input
                      className={`mt-2 ${fieldClass()}`}
                      type="number"
                      min={0}
                      value={plan.monthlyPriceKes}
                      onChange={(e) => patchPack(planIndex, { monthlyPriceKes: Number(e.target.value) })}
                    />
                  </label>
                </div>
                <p className="mt-3 text-sm tabular-nums text-ink-soft">
                  Per year {packagePriceLabel(annualPriceKes(plan.monthlyPriceKes, rates.annualDiscountPercent))}
                </p>
                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  {COUNT_FIELDS.map(([label, key]) => (
                    <label key={key} className="block text-sm">
                      <span className="font-medium text-ink">{label}</span>
                      <input
                        className={`mt-2 ${fieldClass()}`}
                        type="number"
                        min={0}
                        value={plan[key]}
                        onChange={(e) => patchPack(planIndex, { [key]: Number(e.target.value) })}
                      />
                    </label>
                  ))}
                </div>
                <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                  <label className="relative inline-flex min-h-11 cursor-pointer items-center gap-3 rounded-lg px-1 text-sm font-medium text-ink focus-within:outline-none focus-within:ring-2 focus-within:ring-brand">
                    <span
                      aria-hidden
                      className={`pointer-events-none relative inline-flex h-7 w-12 shrink-0 items-center rounded-full ${deskShiftClass} ${
                        plan.isActive ? "bg-accent-fill" : "bg-line"
                      }`}
                    >
                      <span
                        className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-surface shadow ${deskShiftClass} ${
                          plan.isActive ? "translate-x-6" : "translate-x-1"
                        }`}
                      />
                    </span>
                    Live
                    <input
                      type="checkbox"
                      className="absolute inset-0 z-10 h-full w-full cursor-pointer opacity-0"
                      checked={plan.isActive}
                      onChange={(e) => patchPack(planIndex, { isActive: e.target.checked })}
                      aria-label={`${plan.name} live on landing`}
                    />
                  </label>
                  <button type="submit" disabled={pending} className={btnPrimary}>
                    Save
                  </button>
                </div>
              </form>
            ) : null}
          </div>
        )
      ) : null}

      {walk === "assign" ? (
        businesses.length === 0 ? (
          <Empty title="No businesses." />
        ) : (
          <div className="lg:grid lg:grid-cols-2 lg:items-start lg:gap-8">
            <div>
              <ul className="md:hidden">
                {businesses.map((row) => {
                  const on = row.tenantId === businessId;
                  return (
                    <li key={row.tenantId} className="border-b border-line">
                      <button
                        type="button"
                        aria-pressed={on}
                        onClick={() => selectBusiness(row.tenantId)}
                        className={`flex min-h-11 w-full flex-col justify-center py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand ${
                          on ? "border-s-[3px] border-brand ps-3" : ""
                        }`}
                      >
                        <span className={`font-medium text-ink ${deskPreviewClass}`}>{row.businessName}</span>
                        <span className={`mt-0.5 text-meta text-ink-soft ${deskPreviewClass}`}>
                          {row.packageName || "None"}
                          {row.period ? ` · ${row.period}` : ""}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
              <div className="hidden overflow-x-auto md:block">
                <table className="w-full min-w-[520px] text-left text-sm">
                  <caption className="sr-only">Businesses</caption>
                  <thead className="border-b border-line text-ink-soft">
                    <tr>
                      <th className={tableHeadCellClass}>Business</th>
                      <th className={tableHeadCellClass}>Package</th>
                      <th className={tableHeadCellClass}>Period</th>
                    </tr>
                  </thead>
                  <tbody>
                    {businesses.map((row) => {
                      const on = row.tenantId === businessId;
                      return (
                        <tr key={row.tenantId} className={`border-b border-line ${on ? "bg-surface-2" : ""}`}>
                          <td className={`${tableCellClass} ${deskPreviewCellClass}`}>
                            <button
                              type="button"
                              aria-pressed={on}
                              onClick={() => selectBusiness(row.tenantId)}
                              className={`flex min-h-11 w-full items-center text-left font-medium text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand ${
                                on ? "border-s-[3px] border-brand ps-2" : ""
                              } ${deskPreviewClass}`}
                            >
                              {row.businessName}
                            </button>
                          </td>
                          <td className={`${tableCellClass} text-ink-soft`}>{row.packageName || "None"}</td>
                          <td className={`${tableCellClass} text-ink-soft`}>{row.period || "None"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            <form
              className="mt-6 grid gap-4 sm:grid-cols-2 lg:mt-0"
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
              <label className="block text-sm">
                <span className="font-medium text-ink">Package</span>
                <select
                  className={`mt-2 ${fieldClass()}`}
                  value={packageId}
                  onChange={(e) => setPackageId(e.target.value)}
                >
                  {packs
                    .filter((pack) => pack.isActive || pack.id === packageId)
                    .map((pack) => (
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
              <div className="sm:col-span-2">
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
          </div>
        )
      ) : null}
    </div>
  );
}
