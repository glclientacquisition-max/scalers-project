"use client";

import { useState } from "react";
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
}: {
  pack: PublicPackageOffer;
  period: "month" | "year";
}) {
  const price = period === "year" ? pack.annualPriceKes : pack.monthlyPriceKes;
  return (
    <article className="flex flex-col rounded-2xl border border-line bg-surface p-5">
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

function liveRates(board: PublicPackageBoard): boolean {
  return (
    board.inboundKesPerMinute > 0 ||
    board.smsKes > 0 ||
    board.emailKes > 0 ||
    board.whatsappKes > 0
  );
}

export function PackagePrices({
  board,
}: {
  board: PublicPackageBoard;
}) {
  const [period, setPeriod] = useState<"month" | "year">("month");
  const packs = board.packages;

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h2 className="font-display text-display text-ink">Packages</h2>
        {packs.length > 0 ? (
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
        ) : null}
      </div>

      {packs.length === 0 ? (
        <p className="mt-8 text-sm text-ink-soft">Prices are not on this page yet.</p>
      ) : (
        <div className="mt-8 grid gap-4 md:grid-cols-3">
          {packs.map((pack) => (
            <PlanCard key={pack.sku} pack={pack} period={period} />
          ))}
        </div>
      )}

      {liveRates(board) ? (
        <p className="mt-6 max-w-xl text-sm leading-relaxed text-ink-soft">
          On-demand, past included: calls KES {formatKes(board.inboundKesPerMinute)}/min. SMS KES{" "}
          {formatKes(board.smsKes)}. Email KES {formatKes(board.emailKes)}. WhatsApp KES{" "}
          {formatKes(board.whatsappKes)}.
        </p>
      ) : null}

    </div>
  );
}
