"use client";

import { useState } from "react";
import type { PublicPackageBoard, PublicPackageOffer } from "@/lib/packageCatalog";
import { BETA_PLAN, BETA_PROGRAM } from "@/lib/accessPlan";
import { formatKes } from "@/lib/packagePriceLabel";
import { LandingCta } from "@/components/marketing/LandingCta";

const INCLUDED: Array<{ label: string; key: "minutes" | "sms" | "email" | "staffWa" | "seats" }> = [
  { label: "Call minutes", key: "minutes" },
  { label: "SMS", key: "sms" },
  { label: "Email", key: "email" },
  { label: "WhatsApp", key: "staffWa" },
  { label: "Seats", key: "seats" },
];

const cardBase =
  "relative flex cursor-pointer flex-col rounded-2xl border-2 bg-surface p-5 transition-colors focus-within:shadow-focus";

function Pick({
  value,
  picked,
  onPick,
  children,
  featured = false,
}: {
  value: string;
  picked: string;
  onPick: (v: string) => void;
  children: React.ReactNode;
  featured?: boolean;
}) {
  const on = picked === value;
  return (
    <label
      className={`${cardBase} ${on ? "" : "border-line"}`}
      style={on ? { borderColor: "var(--landing-cta)" } : undefined}
      data-plan-card={value}
      data-featured={featured ? "" : undefined}
    >
      <input
        type="radio"
        name="plan"
        value={value}
        checked={on}
        onChange={() => onPick(value)}
        className="sr-only"
      />
      {children}
    </label>
  );
}

function PackageCard({ pack }: { pack: PublicPackageOffer }) {
  return (
    <>
      <h3 className="font-display text-title text-ink">{pack.name}</h3>
      <p className="mt-3 font-display text-2xl tabular-nums text-ink">
        KSh {formatKes(pack.monthlyPriceKes)}
        <span className="ms-1 text-sm font-normal text-ink-2">a month</span>
      </p>
      <dl className="mt-4 border-t border-line">
        {INCLUDED.map((row) => (
          <div key={row.key} className="flex items-baseline justify-between gap-3 border-b border-line py-2">
            <dt className="text-sm text-ink-2">{row.label}</dt>
            <dd className="text-sm tabular-nums text-ink">{pack[row.key].toLocaleString("en-KE")}</dd>
          </div>
        ))}
      </dl>
    </>
  );
}

function onDemandLine(board: PublicPackageBoard): string | null {
  if (!(board.inboundKesPerMinute > 0)) return null;
  const parts = [`calls KSh ${formatKes(board.inboundKesPerMinute)} a minute`];
  if (board.smsKes > 0) parts.push(`SMS KSh ${formatKes(board.smsKes)}`);
  if (board.emailKes > 0) parts.push(`email KSh ${formatKes(board.emailKes)}`);
  if (board.whatsappKes > 0) parts.push(`WhatsApp KSh ${formatKes(board.whatsappKes)}`);
  return `Past what's included, you pay on demand: ${parts.join(", ")}.`;
}

/** Pick a plan, then Request access with it. Beta program is featured and picked first. Prices come from billing_packages. */
export function PackagePrices({ board }: { board: PublicPackageBoard }) {
  const [picked, setPicked] = useState<string>(BETA_PLAN);
  const extra = onDemandLine(board);
  return (
    <div>
      <fieldset>
        <legend className="sr-only">Choose a plan</legend>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <Pick value={BETA_PLAN} picked={picked} onPick={setPicked} featured>
            <span
              className="self-start rounded-full px-2.5 py-1 text-xs font-semibold"
              style={{ background: "var(--landing-glow)", color: "var(--landing-cta)" }}
            >
              Featured
            </span>
            <h3 className="mt-3 font-display text-title text-ink">{BETA_PROGRAM.name}</h3>
            <p className="mt-2 text-sm leading-relaxed text-ink-2">{BETA_PROGRAM.line}</p>
            <ul className="mt-4 space-y-2 border-t border-line pt-4 text-sm text-ink">
              {BETA_PROGRAM.points.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </Pick>
          {board.packages.filter((pack) => pack.monthlyPriceKes > 0).map((pack) => (
            <Pick key={pack.sku} value={pack.sku} picked={picked} onPick={setPicked}>
              <PackageCard pack={pack} />
            </Pick>
          ))}
        </div>
      </fieldset>
      {board.packages.length === 0 ? (
        <p className="mt-4 text-sm text-ink-2">Package prices are not on this page yet.</p>
      ) : null}
      {extra ? <p className="mt-6 max-w-xl text-sm leading-relaxed text-ink-2">{extra}</p> : null}
      <div className="sticky bottom-0 -mx-5 mt-8 border-t border-line bg-canvas/95 px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4 sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:p-0">
        <LandingCta href={`/signup?plan=${encodeURIComponent(picked)}`} />
      </div>
    </div>
  );
}
