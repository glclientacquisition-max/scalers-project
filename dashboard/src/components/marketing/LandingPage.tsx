import Image from "next/image";
import { appEntryHref } from "@/lib/adminHost";
import { brandAssets } from "@/components/brand/assets";
import { HeroCall } from "@/components/marketing/LandingStory";
import {
  LandingHowItWorks,
  LandingKeepNumber,
  LandingMoments,
  LandingPackages,
  LandingQuestions,
  LandingReach,
} from "@/components/marketing/LandingSections";
import { HOME_COPY, type LandingCopy } from "@/components/marketing/landingCopy";
import { exampleLine } from "@/components/marketing/segments";
import { LandingCta } from "@/components/marketing/LandingCta";
import { AppearanceFooter } from "@/components/ThemePicker";

const h2 = "font-display text-2xl tracking-tight text-ink sm:text-3xl";

/**
 * Marketing home and trade pages. The hero is a luminous blue that fades into the page, with a
 * soft orange warmth only at the horizon. Orange is used nowhere else.
 * One job: request access. Short words: one headline, one line, one button.
 * Signed-in owners get a way back to their Desk instead.
 */
export function LandingPage({
  signedIn = false,
  copy = HOME_COPY,
  examples = [],
  example = null,
  cta = "Request access",
}: {
  signedIn?: boolean;
  copy?: LandingCopy;
  examples?: readonly string[];
  example?: { caller: string; does: string } | null;
  cta?: string;
}) {
  const forExample = exampleLine(examples);
  return (
    <main className="landing-scope overflow-x-clip bg-canvas text-ink" data-landing={copy.key}>
      <a href="#landing-start" className="landing-skip landing-focus">Skip to content</a>
      <div className="relative isolate overflow-hidden text-white" data-landing-hero="">
        <div className="pointer-events-none absolute inset-0 -z-10" aria-hidden>
          <div
            className="landing-drift absolute inset-0 opacity-[0.1]"
            style={{
              backgroundImage: `url(${brandAssets.iconTransparent})`,
              backgroundRepeat: "no-repeat",
              backgroundPosition: "78% 28%",
              backgroundSize: "min(92vw, 720px)",
            }}
          />
          <div className="landing-hero-sky absolute inset-0" />
          <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-b from-transparent to-canvas" data-landing-fade="" />
          <div className="landing-horizon" data-landing-warm="" />
        </div>
        <header className="mx-auto flex max-w-desk items-center justify-between gap-2 px-5 pt-[max(1rem,env(safe-area-inset-top))] sm:px-8">
          {/* Plain <a>: marketing pages never prefetch app routes (tests/marketingLinks). */}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a
            href="/"
            aria-label="Scalers home"
            className="landing-focus inline-flex min-h-11 items-center gap-2 rounded-xl"
          >
            <Image src={brandAssets.iconTransparent} alt="" width={36} height={36} priority className="h-9 w-9 object-contain" />
            <span className="font-display text-xl tracking-tight text-white">Scalers</span>
          </a>
          <nav className="flex shrink-0 items-center gap-1">
            {/* Plain <a>: this file must not import next/link (tests/marketingLinks). */}
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a
              href="/for"
              className="landing-focus inline-flex min-h-11 items-center rounded-xl px-3 text-sm font-medium text-white/90 hover:text-white"
            >
              Businesses
            </a>
            {signedIn ? (
              <a
                href={appEntryHref("/home")}
                className="landing-focus inline-flex min-h-11 items-center rounded-xl px-3 text-sm font-medium text-white"
              >
                Open Desk
              </a>
            ) : (
              <a
                href={appEntryHref("/login")}
                className="landing-focus inline-flex min-h-11 items-center rounded-xl px-3 text-sm font-medium text-white/90 hover:text-white"
              >
                Sign in
              </a>
            )}
          </nav>
        </header>

        <section id="landing-start" className="mx-auto grid max-w-desk items-center gap-10 px-5 pb-16 pt-8 sm:px-8 lg:grid-cols-[1.1fr_1fr] lg:gap-14 lg:pb-24 lg:pt-14">
          <div className="min-w-0 max-w-xl">
            <h1 className="landing-rise font-display text-[2.25rem] leading-[1.1] tracking-tight text-white text-balance sm:text-5xl lg:text-6xl">
              {copy.h1}
            </h1>
            <p className="landing-rise landing-rise-delay-1 mt-4 max-w-md text-lg leading-relaxed text-white/90">{copy.sub}</p>
            {forExample ? <p className="landing-rise mt-3 text-base text-white/90">{forExample}</p> : null}
            <div className="landing-rise landing-rise-delay-2 mt-7 flex flex-col items-stretch gap-3 sm:flex-row sm:items-center">
              {signedIn ? <LandingCta href="/home" label="Open Desk" tone="onDark" wide /> : <LandingCta label={cta} tone="onDark" wide />}
              <a
                href="/pricing"
                className="landing-focus inline-flex min-h-[3.25rem] items-center justify-center rounded-xl border border-white/40 px-6 text-base font-semibold text-white transition-colors hover:border-white/70 hover:bg-white/10"
              >
                See pricing
              </a>
            </div>
          </div>
          <div className="relative z-10 min-w-0">
            <HeroCall glass ask={copy.ask} />
          </div>
        </section>
      </div>

      <LandingMoments items={copy.moments} />
      {example ? (
        <section className="px-5 py-12 sm:px-8" aria-labelledby="landing-example" data-landing-section="example">
          <div className="mx-auto max-w-desk">
            <h2 id="landing-example" className={h2}>
              A call
            </h2>
            <p className="mt-3 max-w-xl text-base text-ink">{example.caller}</p>
            <p className="mt-2 max-w-xl text-base leading-relaxed text-ink-2">{example.does}</p>
          </div>
        </section>
      ) : null}
      <LandingReach />
      <LandingHowItWorks />
      <LandingKeepNumber />
      <LandingPackages />
      <LandingQuestions />

      <section className="relative overflow-hidden px-5 pb-16 pt-6 sm:px-8" data-landing-final="">
        <div className="landing-glow pointer-events-none absolute inset-x-0 bottom-0 h-64" aria-hidden />
        <div className="relative mx-auto max-w-desk">
          <h2 className="font-display text-2xl tracking-tight text-ink sm:text-3xl">{copy.finalHeading}</h2>
          <div className="mt-6">{signedIn ? <LandingCta href="/home" label="Open Desk" wide /> : <LandingCta label={cta} wide />}</div>
        </div>
      </section>

      <footer className="flex justify-center border-t border-hairline px-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-3">
        <AppearanceFooter />
      </footer>
    </main>
  );
}
