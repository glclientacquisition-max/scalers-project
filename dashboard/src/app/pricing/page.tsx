import type { Metadata } from "next";
import Image from "next/image";
import { Suspense } from "react";
import { brandAssets } from "@/components/brand/assets";
import { appEntryHref, marketingHomeHref } from "@/lib/adminHost";
import { loadPublicPackageOffers } from "@/lib/packageCatalog";
import { PackagePrices } from "@/components/marketing/PackagePrices";
import { AppearanceFooter } from "@/components/ThemePicker";
import { marketingFontClass } from "@/app/marketingFonts";

export const metadata: Metadata = {
  title: "Pricing · Scalers",
  description: "Monthly packages in KES. Request access to start.",
};

/** Public prices from billing_packages (read only). Same dark hero as home, then the plans. Beta is featured. */
export default function PricingPage() {
  return (
    <div className={`${marketingFontClass} contents`}>
      <main className="landing-scope min-h-dvh overflow-x-clip bg-canvas text-ink" data-pricing="">
        <div className="relative isolate overflow-hidden bg-brand-900 text-white" data-pricing-hero="">
          <div className="pointer-events-none absolute inset-0 -z-10" aria-hidden>
            <div
              className="landing-drift absolute inset-0 opacity-[0.12]"
              style={{
                backgroundImage: `url(${brandAssets.iconTransparent})`,
                backgroundRepeat: "no-repeat",
                backgroundPosition: "78% 42%",
                backgroundSize: "min(92vw, 720px)",
              }}
            />
            <div className="absolute inset-0 bg-gradient-to-br from-brand-900 via-brand-800/95 to-brand-700/80" />
            <div className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-brand-900 to-transparent" />
          </div>
          <header className="mx-auto flex max-w-desk items-center justify-between gap-2 px-5 pt-[max(1rem,env(safe-area-inset-top))] sm:px-8">
            {/* Plain <a>: marketing pages never prefetch app routes (tests/marketingLinks). */}
            <a
              href={marketingHomeHref()}
              aria-label="Scalers home"
              className="inline-flex min-h-11 items-center gap-2 rounded-xl focus-visible:outline-none focus-visible:shadow-focus"
            >
              <Image src={brandAssets.iconTransparent} alt="" width={36} height={36} priority className="h-9 w-9 object-contain" />
              <span className="font-display text-xl tracking-tight text-white">Scalers</span>
            </a>
            <a
              href={appEntryHref("/login")}
              className="inline-flex min-h-11 items-center rounded-xl px-3 text-sm font-medium text-white/85 hover:text-white focus-visible:outline-none focus-visible:shadow-focus"
            >
              Sign in
            </a>
          </header>
          <section className="mx-auto max-w-desk px-5 pb-28 pt-8 sm:px-8">
            <h1 className="font-display text-[2.25rem] leading-[1.1] tracking-tight text-white text-balance sm:text-5xl">Pricing</h1>
            <p className="mt-3 max-w-md text-lg leading-relaxed text-sky-100/90">Monthly packages in KES.</p>
          </section>
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-28 bg-gradient-to-b from-transparent to-canvas" data-pricing-fade="" />
        </div>

        <section className="mx-auto max-w-desk px-5 pb-12 pt-8 sm:px-8">
          <Suspense fallback={<div className="h-96 rounded-2xl bg-surface-2" aria-hidden="true" />}>
            <Plans />
          </Suspense>
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
