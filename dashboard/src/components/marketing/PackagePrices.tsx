"use client";

import { useState } from "react";
import type { PublicPackageBoard, PublicPackageOffer } from "@/lib/packageCatalog";
import { BETA_PLAN, BETA_PROGRAM } from "@/lib/accessPlan";
import { EXAMPLE_MINUTES, kes, usageRows, workedExample } from "@/components/marketing/pricingMath";
import { LandingCta } from "@/components/marketing/LandingCta";

/** Hick: three packages at most next to the featured Beta program. More live packages stay off the public page. */
export const MAX_PUBLIC_PACKAGES = 3;

const INCLUDED: Array<{ label: string; key: "minutes" | "sms" | "email" | "staffWa" | "seats" }> = [
  { label: "Call minutes", key: "minutes" },
  { label: "SMS", key: "sms" },
  { label: "Email", key: "email" },
  { label: "WhatsApp", key: "staffWa" },
  { label: "Seats", key: "seats" },
];


const cardBase =
  "relative flex h-full cursor-pointer flex-col rounded-2xl border-2 bg-surface p-5 transition-colors focus-within:shadow-focus";

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
      className={`${cardBase} ${on ? "shadow-lift" : "border-line"}`}
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
      <p className="mt-3 font-display text-3xl tracking-tight tabular-nums text-ink">
        {kes(pack.monthlyPriceKes)}
        <span className="ms-1 [font-family:var(--font-body)] text-sm font-normal tracking-normal text-ink-2">a month</span>
      </p>
      <dl className="mt-4 border-t border-line">
        {INCLUDED.filter((row) => pack[row.key] > 0).map((row) => (
          <div key={row.key} className="flex items-baseline justify-between gap-3 border-b border-line py-2 last:border-0">
            <dt className="text-sm text-ink-2">{row.label}</dt>
            <dd className="text-sm font-medium tabular-nums text-ink">{pack[row.key].toLocaleString("en-KE")}</dd>
          </div>
        ))}
      </dl>
    </>
  );
}

/** True facts only (billing code as of 30 Oct): packages + on-demand, per-second metering, monthly reset. */
const BILLING_FAQ: ReadonlyArray<[string, string]> = [
  ["What is in a package?", "A monthly price with call minutes and messages included."],
  ["What if I use more?", "Past what's included, you pay on demand at the rates above. Calls are metered by the second."],
  ["Do unused minutes carry over?", "No. Included minutes end with each billing period."],
];

/** Pick a plan, then Request access with it. Beta program is featured and picked first. Prices come from billing_packages. */
export function PackagePrices({ board }: { board: PublicPackageBoard }) {
  const [picked, setPicked] = useState<string>(BETA_PLAN);
  const packs = board.packages.filter((pack) => pack.monthlyPriceKes > 0).slice(0, MAX_PUBLIC_PACKAGES);
  const rows = usageRows(board);
  const example = workedExample(board);
  return (
    <div>
      <fieldset>
        <legend className="sr-only">Choose a plan</legend>
        <div className={`grid gap-4 md:grid-cols-2 ${packs.length >= 3 ? "lg:grid-cols-4" : "lg:grid-cols-3"}`}>
          <div className="relative">
            <div className="landing-orbs" aria-hidden data-pricing-orbs="" />
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
                  <li key={p} className="flex gap-2">
                    <span aria-hidden className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--landing-cta)]" />
                    {p}
                  </li>
                ))}
              </ul>
            </Pick>
          </div>
          {packs.map((pack) => (
            <Pick key={pack.sku} value={pack.sku} picked={picked} onPick={setPicked}>
              <PackageCard pack={pack} />
            </Pick>
          ))}
        </div>
      </fieldset>
      {board.packages.length === 0 ? (
        <p className="mt-4 text-sm text-ink-2">Package prices are not on this page yet.</p>
      ) : null}

      {rows.length ? (
        <section className="mt-12 max-w-xl" aria-labelledby="pricing-usage" data-pricing-usage="">
          <h2 id="pricing-usage" className="font-display text-xl tracking-tight text-ink">
            On demand
          </h2>
          <dl className="mt-3 rounded-2xl border border-hairline bg-surface px-5">
            {rows.map(([label, value]) => (
              <div key={label} className="flex items-baseline justify-between gap-3 border-b border-line py-3 last:border-0">
                <dt className="text-base text-ink">{label}</dt>
                <dd className="text-base font-semibold tabular-nums text-ink">{value}</dd>
              </div>
            ))}
          </dl>
          {example ? (
            <p className="mt-3 rounded-2xl bg-[var(--landing-glow)] px-5 py-4 text-base text-ink" data-pricing-example="">
              A {EXAMPLE_MINUTES}-minute answered call costs <b className="tabular-nums">{example}</b>.
            </p>
          ) : null}
        </section>
      ) : null}

      <section className="mt-12 max-w-xl" aria-labelledby="pricing-faq" data-pricing-faq="">
        <h2 id="pricing-faq" className="font-display text-xl tracking-tight text-ink">
          Questions
        </h2>
        <dl className="mt-3 divide-y divide-hairline border-y border-hairline">
          {BILLING_FAQ.map(([q, a]) => (
            <div key={q} className="py-3">
              <dt className="text-base font-semibold text-ink">{q}</dt>
              <dd className="mt-1 text-base leading-relaxed text-ink-2">{a}</dd>
            </div>
          ))}
        </dl>
      </section>

      <div className="sticky bottom-0 z-10 -mx-5 mt-10 border-t border-line bg-canvas/95 px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4 backdrop-blur sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:p-0 sm:backdrop-blur-none">
        <LandingCta href={`/signup?plan=${encodeURIComponent(picked)}`} wide />
      </div>
    </div>
  );
}
