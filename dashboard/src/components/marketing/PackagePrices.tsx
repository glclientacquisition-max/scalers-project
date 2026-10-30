"use client";

import { useState } from "react";
import type { PublicPackageBoard, PublicPackageOffer } from "@/lib/packageCatalog";
import {
  EXTRA_USAGE_LINE,
  creditUseLine,
  fitLine,
  isGrowthPlan,
  kes,
  perDayKes,
  plansForPage,
  pricingFaq,
  sharedCreditBurns,
  workedExample,
} from "@/components/marketing/pricingMath";
import { LandingCta } from "@/components/marketing/LandingCta";
import { SegmentedControl } from "@/components/ui/Segmented";
import { appEntryHref } from "@/lib/adminHost";

/** Hick: three paid plans. Beta is not a plan on this page. */
export const MAX_PUBLIC_PACKAGES = 3;

const cardBase = "relative flex h-full flex-col rounded-2xl border-2 bg-surface p-5";

function PlanLink({ href, label, filled }: { href: string; label: string; filled: boolean }) {
  if (filled) return <LandingCta href={href} label={label} size="md" wide />;
  return (
    <a
      href={appEntryHref(href)}
      className="landing-focus inline-flex min-h-11 w-full items-center justify-center rounded-xl border border-line px-4 text-sm font-semibold text-ink"
    >
      {label}
    </a>
  );
}

function PackageCard({ pack, yearly }: { pack: PublicPackageOffer; yearly: boolean }) {
  const annual = yearly && pack.annualPriceKes > 0;
  const amount = annual ? pack.annualPriceKes : pack.monthlyPriceKes;
  const day = perDayKes(pack.monthlyPriceKes);
  const about = fitLine(pack.minutes);
  const recommended = isGrowthPlan(pack);
  const rows: Array<[string, string]> = [["Call minutes", pack.minutes.toLocaleString("en-KE")]];
  if (pack.messageCredits != null) rows.push(["Message credits", pack.messageCredits.toLocaleString("en-KE")]);
  if (pack.seats > 0) rows.push(["Team logins", pack.seats.toLocaleString("en-KE")]);
  return (
    <article
      className={`${cardBase} ${recommended ? "" : "border-line"}`}
      style={recommended ? { borderColor: "var(--landing-cta)" } : undefined}
      data-plan-card={pack.sku}
      data-recommended={recommended ? "" : undefined}
    >
      <p className="min-h-7">
        {recommended ? (
          <span
            className="inline-flex rounded-full px-2.5 py-1 text-xs font-semibold"
            style={{ background: "var(--landing-glow)", color: "var(--landing-cta)" }}
          >
            Recommended
          </span>
        ) : null}
      </p>
      <h3 className="mt-3 font-display text-title text-ink">{pack.name}</h3>
      <p className="mt-3 font-display text-4xl tracking-tight tabular-nums text-ink">
        {kes(amount)}
        <span className="ms-1 [font-family:var(--font-body)] text-sm font-normal tracking-normal text-ink-2">
          {annual ? "a year" : "a month"}
        </span>
      </p>
      {annual && pack.annualDiscountPercent > 0 ? (
        <p className="mt-1 text-sm font-medium tabular-nums text-ink">{pack.annualDiscountPercent}% off</p>
      ) : null}
      {!annual && day > 0 ? <p className="mt-1 text-sm tabular-nums text-ink-2">{kes(day)} a day</p> : null}
      {about ? <p className="mt-2 text-sm text-ink-2">{about}</p> : null}
      <dl className="mt-4 border-t border-line">
        {rows.map(([label, value]) => (
          <div key={label} className="flex items-baseline justify-between gap-3 border-b border-line py-2 last:border-0">
            <dt className="text-sm text-ink-2">{label}</dt>
            <dd className="text-sm font-medium tabular-nums text-ink">{value}</dd>
          </div>
        ))}
      </dl>
      {pack.inboundKesPerMinute > 0 ? (
        <p className="mt-3 text-sm text-ink-2">
          Extra minute <span className="font-semibold tabular-nums text-ink">{kes(pack.inboundKesPerMinute)}</span>
        </p>
      ) : null}
      <div className="mt-4">
        <PlanLink href={`/signup?plan=${encodeURIComponent(pack.sku)}`} label={`Request ${pack.name}`} filled={recommended} />
      </div>
    </article>
  );
}

/** Three paid plans. Growth is marked Recommended. Prices come from each published version. */
export function PackagePrices({ board }: { board: PublicPackageBoard }) {
  const [cycle, setCycle] = useState<"month" | "year">("month");
  const packs = plansForPage(board).slice(0, MAX_PUBLIC_PACKAGES);
  const yearly = cycle === "year";
  const showAnnual = packs.some((pack) => pack.annualPriceKes > 0);
  const burns = sharedCreditBurns(packs);
  const credits = creditUseLine(burns);
  const example = workedExample(board);
  const oneNumber = packs.length > 0 && packs.every((pack) => pack.dids === 1);
  const faq = pricingFaq(burns);
  return (
    <div>
      {showAnnual ? (
        <div className="mb-6" data-pricing-cycle={cycle}>
          <SegmentedControl
            label="Pay monthly or annual"
            value={cycle}
            onChange={(value) => setCycle(value === "year" ? "year" : "month")}
            items={[
              { value: "month", label: "Monthly" },
              { value: "year", label: "Annual" },
            ]}
          />
        </div>
      ) : null}
      {packs.length ? (
        <div className={`grid items-stretch gap-4 ${packs.length >= 3 ? "lg:grid-cols-3" : "lg:grid-cols-2"}`}>
          {packs.map((pack) => (
            <PackageCard key={pack.sku} pack={pack} yearly={yearly} />
          ))}
        </div>
      ) : null}
      {board.packages.length === 0 ? (
        <p className="mt-4 text-sm text-ink-2">Package prices are not on this page yet.</p>
      ) : null}

      {packs.length ? (
        <section className="mt-12 max-w-xl" aria-labelledby="pricing-included" data-pricing-included="">
          <h2 id="pricing-included" className="font-display text-xl tracking-tight text-ink">
            Every package includes
          </h2>
          <ul className="mt-3 space-y-2 text-base text-ink">
            <li>{"Answers when you're busy, closed, or on another call"}</li>
            <li>An inbox of calls</li>
            <li>Call alerts by SMS, WhatsApp, or email</li>
            {oneNumber ? <li>One number</li> : null}
          </ul>
          {credits ? <p className="mt-3 text-base text-ink-2">{credits}</p> : null}
        </section>
      ) : null}

      <section className="mt-12 max-w-xl" aria-labelledby="pricing-usage" data-pricing-usage="">
        <h2 id="pricing-usage" className="font-display text-xl tracking-tight text-ink">
          If you go past your minutes
        </h2>
        <p className="mt-2 text-base text-ink-2">{EXTRA_USAGE_LINE}</p>
        {example ? (
          <p className="mt-3 rounded-2xl bg-[var(--landing-glow)] px-5 py-4 text-base text-ink" data-pricing-example="">
            {example}
          </p>
        ) : null}
      </section>

      <section className="mt-12 max-w-xl" aria-labelledby="pricing-faq" data-pricing-faq="">
        <h2 id="pricing-faq" className="font-display text-xl tracking-tight text-ink">
          Questions
        </h2>
        <dl className="mt-3 divide-y divide-hairline border-y border-hairline">
          {faq.map(([q, a]) => (
            <div key={q} className="py-3">
              <dt className="text-base font-semibold text-ink">{q}</dt>
              <dd className="mt-1 text-base leading-relaxed text-ink-2">{a}</dd>
            </div>
          ))}
        </dl>
      </section>

      <div className="mt-10 flex items-center gap-3" data-pricing-dock="">
        <div className="min-w-0 flex-1">
          <LandingCta href="/signup" size="md" wide />
        </div>
      </div>
      <p className="mt-3 text-sm text-ink-2">We set up your assistant with you.</p>
    </div>
  );
}
