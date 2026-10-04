"use client";

import { useState } from "react";
import Link from "next/link";
import type { PublicPackageBoard, PublicPackageOffer } from "@/lib/packageCatalog";
import { formatKes, packagePriceLabel } from "@/lib/packagePriceLabel";

const INCLUDED: Array<{ label: string; key: "sms" | "email" | "staffWa" | "seats" | "dids" }> = [
  { label: "SMS", key: "sms" },
  { label: "Email", key: "email" },
  { label: "WhatsApp", key: "staffWa" },
  { label: "Seats", key: "seats" },
  { label: "Number", key: "dids" },
];

function PlanCard({
  pack,
  period,
  anchor,
}: {
  pack: PublicPackageOffer;
  period: "month" | "year";
  anchor: boolean;
}) {
  const price = period === "year" ? pack.annualPriceKes : pack.monthlyPriceKes;
  return (
    <article
      className={`flex flex-col rounded-2xl border bg-surface p-5 ${anchor ? "border-accent" : "border-line"}`}
    >
      <h3 className="font-display text-title text-ink">{pack.name}</h3>
      <p className="mt-4 font-display text-display tabular-nums text-ink">{packagePriceLabel(price)}</p>
      <p className="mt-1 text-meta text-ink-soft">{period === "month" ? "Per month" : "Per year"}</p>
      <dl className="mt-6 border-t border-line">
        <div className="flex items-baseline justify-between gap-3 border-b border-line py-2">
          <dt className="text-meta text-ink-soft">Minutes</dt>
          <dd className="text-body tabular-nums text-ink">{pack.minutes.toLocaleString("en-KE")}</dd>
        </div>
        {INCLUDED.map((row) => (
          <div key={row.key} className="flex items-baseline justify-between gap-3 border-b border-line py-2">
            <dt className="text-meta text-ink-soft">{row.label}</dt>
            <dd className="text-body tabular-nums text-ink">{pack[row.key].toLocaleString("en-KE")}</dd>
          </div>
        ))}
      </dl>
    </article>
  );
}

export function PackagePrices({
  board,
  actionHref = "/signup",
  actionLabel = "Sign up",
}: {
  board: PublicPackageBoard;
  actionHref?: string;
  actionLabel?: string;
}) {
  const [period, setPeriod] = useState<"month" | "year">("month");
  const packs = board.packages;
  const anchorSku = packs.length === 3 ? "growth" : "";

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h2 className="font-display text-display text-ink">Packages</h2>
        <div className="inline-flex rounded-lg border border-line p-1" role="group" aria-label="Billing period">
          {(["month", "year"] as const).map((value) => {
            const on = period === value;
            return (
              <button
                key={value}
                type="button"
                aria-pressed={on}
                onClick={() => setPeriod(value)}
                className={`min-h-11 rounded-md px-4 text-sm font-medium focus-visible:outline-none focus-visible:shadow-focus ${
                  on ? "bg-accent text-accent-on" : "text-ink"
                }`}
              >
                {value === "month" ? "Month" : "Year"}
              </button>
            );
          })}
        </div>
      </div>

      <div className="mt-8 grid gap-4 md:grid-cols-3">
        {packs.map((pack) => (
          <PlanCard key={pack.sku} pack={pack} period={period} anchor={pack.sku === anchorSku} />
        ))}
      </div>

      <div className="mt-10 overflow-x-auto">
        <table className="w-full min-w-[36rem] text-left text-sm">
          <caption className="sr-only">Included</caption>
          <thead className="border-b border-line text-ink-soft">
            <tr>
              <th scope="col" className="py-2 pr-3 font-medium">Included</th>
              {packs.map((pack) => (
                <th key={pack.sku} scope="col" className="px-3 py-2 text-right font-medium text-ink">
                  {pack.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(
              [
                ["Minutes", "minutes"],
                ["SMS", "sms"],
                ["Email", "email"],
                ["WhatsApp", "staffWa"],
                ["Seats", "seats"],
                ["Number", "dids"],
              ] as const
            ).map(([label, key]) => (
              <tr key={key} className="border-b border-line">
                <th scope="row" className="py-3 pr-3 font-normal text-ink-soft">
                  {label}
                </th>
                {packs.map((pack) => (
                  <td key={pack.sku} className="px-3 py-3 text-right tabular-nums text-ink">
                    {pack[key].toLocaleString("en-KE")}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-6 max-w-xl text-sm leading-relaxed text-ink-soft">
        On-demand, past included: calls KES {formatKes(board.inboundKesPerMinute)}/min. SMS KES{" "}
        {formatKes(board.smsKes)}. Email KES {formatKes(board.emailKes)}. WhatsApp KES{" "}
        {formatKes(board.whatsappKes)}.
      </p>

      <Link
        href={actionHref}
        className="mt-8 inline-flex min-h-12 items-center justify-center rounded-xl bg-brand-900 px-6 text-base font-medium text-white focus-visible:outline-none focus-visible:shadow-focus"
      >
        {actionLabel}
      </Link>
    </div>
  );
}
