"use client";

import { useState } from "react";
import {
  ArrowPathIcon,
  ArrowsRightLeftIcon,
  ClockIcon,
  MinusIcon,
  PauseCircleIcon,
  PlusIcon,
} from "@heroicons/react/24/outline";
import type { PublicPackageBoard, PublicPackageOffer } from "@/lib/packageCatalog";
import {
  billingSteps,
  calculatorMaxMinutes,
  fitLine,
  isGrowthPlan,
  kes,
  lowestThatAnswers,
  monthCost,
  perDayKes,
  plansForPage,
  pricingFaq,
  sharedCreditBurns,
} from "@/components/marketing/pricingMath";
import { LandingCta } from "@/components/marketing/LandingCta";
import { SegmentedControl } from "@/components/ui/Segmented";
import { IconButton } from "@/components/ui/IconButton";
import { Switch } from "@/components/ui/Switch";
import { appEntryHref } from "@/lib/adminHost";

const STEP_ICONS = [ArrowPathIcon, PauseCircleIcon, ClockIcon, ArrowsRightLeftIcon] as const;
const MINUTE_STEP = 10;

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
  const faq = pricingFaq(burns);
  const steps = billingSteps(packs);
  const maxMinutes = calculatorMaxMinutes(packs);
  const [minutesRaw, setMinutesRaw] = useState("450");
  const [extraOn, setExtraOn] = useState(false);
  const typed = Math.max(0, Math.floor(Number(minutesRaw) || 0));
  const minutes = maxMinutes > 0 ? Math.min(maxMinutes, typed) : typed;
  const costs = packs.map((pack) => ({ pack, row: monthCost(pack, minutes, extraOn) }));
  const best = lowestThatAnswers(costs.map((item) => item.row));
  const setMinutes = (next: number) => setMinutesRaw(String(Math.min(maxMinutes, Math.max(0, next))));
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
        <section className="mt-14" aria-labelledby="pricing-billing" data-pricing-billing="">
          <h2 id="pricing-billing" className="font-display text-2xl tracking-tight text-ink">
            How billing works
          </h2>
          <ol className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {steps.map((step, index) => {
              const Icon = STEP_ICONS[index] ?? ArrowPathIcon;
              return (
                <li key={step.title} className="flex gap-3 rounded-2xl border border-hairline bg-surface p-4" data-billing-step={step.title}>
                  <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-surface-2 text-ink-2">
                    <Icon aria-hidden className="h-6 w-6" />
                  </span>
                  <span>
                    <span className="block font-display text-base text-ink">{step.title}</span>
                    <span className="mt-1 block text-sm leading-relaxed text-ink-2">{step.body}</span>
                  </span>
                </li>
              );
            })}
          </ol>
        </section>
      ) : null}

      {packs.length && maxMinutes > 0 ? (
        <section className="mt-14" aria-labelledby="pricing-calculator" data-pricing-calculator="">
          <h2 id="pricing-calculator" className="font-display text-2xl tracking-tight text-ink">
            What a month costs
          </h2>
          <div className="mt-5 rounded-2xl border border-hairline bg-surface p-4 sm:p-5">
            <p className="font-display text-4xl tabular-nums tracking-tight text-ink" data-pricing-minutes="">
              {minutes.toLocaleString("en-KE")}
            </p>
            <p className="text-sm text-ink-2">minutes a month</p>
            <div className="mt-4 flex items-center gap-2">
              <IconButton label="Fewer minutes" disabled={minutes <= 0} onClick={() => setMinutes(minutes - MINUTE_STEP)}>
                <MinusIcon />
              </IconButton>
              <input
                type="range"
                min={0}
                max={maxMinutes}
                step={MINUTE_STEP}
                value={minutes}
                aria-label="Call minutes a month"
                onChange={(event) => setMinutes(Number(event.target.value))}
                className="landing-focus h-11 min-w-0 flex-1 accent-[var(--landing-cta)]"
              />
              <IconButton
                label="More minutes"
                disabled={minutes >= maxMinutes}
                onClick={() => setMinutes(minutes + MINUTE_STEP)}
              >
                <PlusIcon />
              </IconButton>
            </div>
            <div className="mt-4 flex min-h-11 items-center gap-3">
              <Switch checked={extraOn} onCheckedChange={setExtraOn} label="Extra usage" />
              <span className="text-base text-ink">Extra usage</span>
            </div>
            <ul className="mt-4 grid gap-3">
              {costs.map(({ pack, row }) => {
                const recommended = isGrowthPlan(pack);
                return (
                  <li
                    key={row.sku}
                    data-cost={row.sku}
                    data-recommended={recommended ? "" : undefined}
                    className={`flex items-center justify-between gap-3 rounded-2xl border-2 px-4 py-4 ${recommended ? "" : "border-line"}`}
                    style={recommended ? { borderColor: "var(--landing-cta)", background: "var(--landing-glow)" } : undefined}
                  >
                    <span>
                      <span className="block font-display text-xl text-ink">{row.name}</span>
                      {row.extraKes > 0 ? (
                        <span className="mt-0.5 block text-sm text-ink-2">Extra {kes(row.extraKes)}</span>
                      ) : null}
                      {row.unanswered > 0 ? (
                        <span className="mt-0.5 block text-sm text-ink-2">
                          {row.unanswered.toLocaleString("en-KE")} minutes not answered
                        </span>
                      ) : null}
                    </span>
                    <span className="font-display text-2xl tabular-nums tracking-tight text-ink">{kes(row.totalKes)}</span>
                  </li>
                );
              })}
            </ul>
            {best ? (
              <p className="mt-4 text-base text-ink">
                {best.name} answers every call for {kes(best.totalKes)}.
              </p>
            ) : (
              <p className="mt-4 text-base text-ink-2">No plan answers all of those minutes inside the spend limit.</p>
            )}
          </div>
        </section>
      ) : null}

      <section className="mt-14" aria-labelledby="pricing-faq" data-pricing-faq="">
        <h2 id="pricing-faq" className="font-display text-2xl tracking-tight text-ink">
          Questions
        </h2>
        <div className="mt-4 divide-y divide-hairline border-y border-hairline">
          {faq.map(([q, a]) => (
            <details key={q} className="group">
              <summary className="landing-focus flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 rounded-md text-base font-semibold text-ink [&::-webkit-details-marker]:hidden">
                {q}
                <PlusIcon aria-hidden className="h-5 w-5 shrink-0 text-ink-2 transition-transform group-open:rotate-45 motion-reduce:transition-none" />
              </summary>
              <p className="pb-3 text-base leading-relaxed text-ink-2">{a}</p>
            </details>
          ))}
        </div>
      </section>

      <section className="mt-14 rounded-2xl border border-hairline bg-surface px-5 py-8 sm:px-8" data-pricing-band="">
        <p className="font-display text-2xl tracking-tight text-ink">We set up your assistant with you.</p>
        <div className="mt-6 flex items-center" data-pricing-dock="">
          <LandingCta href="/signup" size="md" />
        </div>
      </section>
    </div>
  );
}
