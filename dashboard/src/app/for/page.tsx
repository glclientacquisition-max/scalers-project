import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { brandAssets } from "@/components/brand/assets";
import { appEntryHref, marketingHomeHref } from "@/lib/adminHost";
import { exampleLine, SEGMENTS } from "@/components/marketing/segments";
import { AppearanceFooter } from "@/components/ThemePicker";
import { marketingFontClass } from "@/app/marketingFonts";

export const metadata: Metadata = {
  title: "For your business · Scalers",
  description: "The assistant answers your calls. Home services, a shop, or another business.",
};

/** Hub for the three real business types. Segment pages share one template. */
export default function ForHubPage() {
  return (
    <div className={`${marketingFontClass} contents`}>
      <main className="landing-scope min-h-dvh overflow-x-clip bg-canvas text-ink" data-for-hub="">
        <a href="#for-list" className="landing-skip landing-focus">
          Skip to content
        </a>
        <div className="relative isolate overflow-hidden text-white">
          <div className="pointer-events-none absolute inset-0 -z-10" aria-hidden>
            <div className="landing-hero-sky absolute inset-0" />
            <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-b from-transparent to-canvas" data-landing-fade="" />
            <div className="landing-horizon" data-landing-warm="" />
          </div>
          <header className="mx-auto flex max-w-desk items-center justify-between gap-2 px-5 pt-[max(1rem,env(safe-area-inset-top))] sm:px-8">
            <a
              href={marketingHomeHref()}
              aria-label="Scalers home"
              className="landing-focus inline-flex min-h-11 items-center gap-2 rounded-xl"
            >
              <Image src={brandAssets.iconTransparent} alt="" width={36} height={36} priority className="h-9 w-9 object-contain" />
              <span className="font-display text-xl tracking-tight text-white">Scalers</span>
            </a>
            <nav className="flex shrink-0 items-center gap-1">
              <Link
                href="/pricing"
                className="landing-focus inline-flex min-h-11 items-center rounded-xl px-3 text-sm font-medium text-white/90 hover:text-white"
              >
                Pricing
              </Link>
              <a
                href={appEntryHref("/login")}
                className="landing-focus inline-flex min-h-11 items-center rounded-xl px-3 text-sm font-medium text-white/90 hover:text-white"
              >
                Sign in
              </a>
            </nav>
          </header>
          <section className="mx-auto max-w-desk px-5 pb-24 pt-8 sm:px-8">
            <h1 className="font-display text-[2.25rem] leading-[1.1] tracking-tight text-white text-balance sm:text-5xl">
              For your business
            </h1>
            <p className="mt-3 max-w-md text-lg leading-relaxed text-white/90">The assistant answers your calls.</p>
          </section>
        </div>
        <section id="for-list" className="mx-auto max-w-desk px-5 pb-16 sm:px-8" aria-labelledby="for-list-heading">
          <h2 id="for-list-heading" className="sr-only">
            Business types
          </h2>
          <ul className="mx-auto max-w-xl divide-y divide-hairline border-y border-hairline">
            {SEGMENTS.map((segment) => {
              const note = exampleLine(segment.examples);
              return (
                <li key={segment.slug}>
                  <Link
                    href={`/for/${segment.slug}`}
                    className="landing-focus flex min-h-[4.5rem] flex-col justify-center gap-1 py-3"
                  >
                    <span className="font-display text-xl tracking-tight text-ink">{segment.name}</span>
                    <span className="text-base text-ink-2">{segment.hero}</span>
                    {note ? <span className="text-sm text-ink-3">{note}</span> : null}
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
        <footer className="flex justify-center border-t border-hairline px-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-3">
          <AppearanceFooter />
        </footer>
      </main>
    </div>
  );
}
