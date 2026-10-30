import type { Metadata } from "next";
import { Suspense } from "react";
import { BrandWordmark } from "@/components/brand/BrandMark";
import { appEntryHref, marketingHomeHref } from "@/lib/adminHost";
import { loadPublicPackageOffers } from "@/lib/packageCatalog";
import { PackagePrices } from "@/components/marketing/PackagePrices";
import { AppearanceFooter } from "@/components/ThemePicker";
import { marketingFontClass } from "@/app/marketingFonts";

export const metadata: Metadata = {
  title: "Pricing · Scalers",
  description: "Scalers packages in KES, plus our Beta program. Request access to start.",
};

/** Public prices from billing_packages (read only). Beta program is the featured plan. */
export default function PricingPage() {
  return (
    <div className={`${marketingFontClass} contents`}>
      <main className="landing-scope min-h-dvh overflow-x-clip bg-canvas text-ink" data-pricing="">
        <header className="mx-auto flex max-w-desk items-center justify-between gap-2 px-5 pt-[max(1rem,env(safe-area-inset-top))] sm:px-8">
          <BrandWordmark href={marketingHomeHref()} context="Pricing" variant="lockup" priority />
          <a
            href={appEntryHref("/login")}
            className="inline-flex min-h-11 items-center rounded-xl px-3 text-sm font-medium text-ink-2 hover:text-ink focus-visible:outline-none focus-visible:shadow-focus"
          >
            Sign in
          </a>
        </header>
        <section className="mx-auto max-w-desk px-5 pb-12 pt-8 sm:px-8">
          <h1 className="font-display text-[2.25rem] leading-tight tracking-tight text-ink sm:text-4xl">Pricing</h1>
          <p className="mt-3 max-w-xl text-lg leading-relaxed text-ink-2">Monthly packages in KES. Pay on demand past them.</p>
          <div className="mt-8">
            <Suspense fallback={<div className="h-96 rounded-2xl bg-surface-2" aria-hidden="true" />}>
              <Plans />
            </Suspense>
          </div>
        </section>
        <footer className="flex justify-center pb-[max(1.5rem,env(safe-area-inset-bottom))]">
          <AppearanceFooter />
        </footer>
      </main>
    </div>
  );
}

async function Plans() {
  const board = await loadPublicPackageOffers();
  return <PackagePrices board={board} />;
}
