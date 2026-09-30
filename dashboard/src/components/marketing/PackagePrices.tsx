"use client";

import { useState } from "react";
import Link from "next/link";
import type { PublicPackageBoard } from "@/lib/packageCatalog";

function formatKes(amount: number): string {
  return amount.toLocaleString("en-KE", { maximumFractionDigits: 2 });
}

function priceLabel(amount: number): string {
  if (!(amount > 0)) return "Not set";
  return `KES ${formatKes(amount)}`;
}

const ROWS: Array<{ label: string; key: "minutes" | "sms" | "email" | "staffWa" | "seats" | "dids" }> = [
  { label: "Minutes", key: "minutes" },
  { label: "SMS", key: "sms" },
  { label: "Email", key: "email" },
  { label: "WhatsApp", key: "staffWa" },
  { label: "Seats", key: "seats" },
  { label: "Number", key: "dids" },
];

export function PackagePrices({ board }: { board: PublicPackageBoard }) {
  const [period, setPeriod] = useState<"month" | "year">("month");
  const packs = board.packages;

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

      <div className="mt-6 overflow-x-auto">
        <table className="w-full min-w-[20rem] text-left text-sm">
          <caption className="sr-only">
            {period === "month" ? "Monthly package prices and included amounts" : "Yearly package prices and included amounts"}
          </caption>
          <thead>
            <tr className="border-b border-line text-ink">
              <th scope="col" className="py-3 pr-3 font-medium">
                {period === "month" ? "Per month" : "Per year"}
              </th>
              {packs.map((pack) => (
                <th key={pack.sku} scope="col" className="px-2 py-3 text-right font-display text-base font-medium">
                  {pack.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-line">
              <th scope="row" className="py-3 pr-3 font-medium text-ink">
                Price
              </th>
              {packs.map((pack) => (
                <td key={pack.sku} className="px-2 py-3 text-right text-base font-medium tabular-nums text-ink">
                  {priceLabel(period === "year" ? pack.annualPriceKes : pack.monthlyPriceKes)}
                </td>
              ))}
            </tr>
            {ROWS.map((row) => (
              <tr key={row.key} className="border-b border-line">
                <th scope="row" className="py-3 pr-3 font-normal text-ink-soft">
                  {row.label}
                </th>
                {packs.map((pack) => (
                  <td key={pack.sku} className="px-2 py-3 text-right tabular-nums text-ink">
                    {pack[row.key].toLocaleString("en-KE")}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-4 max-w-xl text-sm leading-relaxed text-ink-soft">
        On-demand, past included: calls KES {formatKes(board.inboundKesPerMinute)}/min in, KES{" "}
        {formatKes(board.outboundKesPerMinute)}/min out. SMS KES {formatKes(board.smsKes)}. Email KES{" "}
        {formatKes(board.emailKes)}. WhatsApp KES {formatKes(board.whatsappKes)}.
      </p>

      <Link
        href="/signup"
        className="mt-6 inline-flex min-h-12 items-center justify-center rounded-lg bg-accent px-6 text-base font-medium text-accent-on focus-visible:outline-none focus-visible:shadow-focus"
      >
        Create workspace
      </Link>
    </div>
  );
}
