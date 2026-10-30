import { appEntryHref } from "@/lib/adminHost";
import { BrandWordmark } from "@/components/brand/BrandMark";
import { HeroCall } from "@/components/marketing/LandingStory";
import {
  LandingHowItWorks,
  LandingKeepNumber,
  LandingMoments,
  LandingPackages,
  LandingQuestions,
  LandingTrust,
} from "@/components/marketing/LandingSections";
import { HOME_COPY, type LandingCopy } from "@/components/marketing/landingCopy";
import { LandingCta } from "@/components/marketing/LandingCta";
import { AppearanceFooter } from "@/components/ThemePicker";

/**
 * Marketing home on the light canvas. One job: request access. Blue (landing token) is the only button colour;
 * soft blue orbs sit behind the hero call card. Short words: one headline, one line, one button.
 * Signed-in owners get a way back to their Desk instead.
 */
export function LandingPage({ signedIn = false, copy = HOME_COPY }: { signedIn?: boolean; copy?: LandingCopy }) {
  return (
    <main className="landing-scope overflow-x-clip bg-canvas text-ink" data-landing={copy.key}>
      <header className="mx-auto flex max-w-desk items-center justify-between gap-2 px-5 pt-[max(1rem,env(safe-area-inset-top))] sm:px-8">
        <BrandWordmark href="/" context={copy.context} variant="lockup" priority />
        <nav className="flex shrink-0 items-center gap-1">
          {signedIn ? (
            <a
              href={appEntryHref("/home")}
              className="inline-flex min-h-11 items-center rounded-xl px-3 text-sm font-medium text-accent-deep focus-visible:outline-none focus-visible:shadow-focus"
            >
              Open Desk
            </a>
          ) : (
            <a
              href={appEntryHref("/login")}
              className="inline-flex min-h-11 items-center rounded-xl px-3 text-sm font-medium text-ink-2 hover:text-ink focus-visible:outline-none focus-visible:shadow-focus"
            >
              Sign in
            </a>
          )}
        </nav>
      </header>

      <section className="mx-auto grid max-w-desk items-center gap-10 px-5 pb-14 pt-8 sm:px-8 lg:grid-cols-[1.1fr_1fr] lg:gap-14 lg:pb-20 lg:pt-14">
        <div className="min-w-0 max-w-xl">
          <h1 className="landing-rise font-display text-[2.25rem] leading-[1.1] tracking-tight text-ink text-balance sm:text-5xl lg:text-6xl">
            {copy.h1}
          </h1>
          <p className="landing-rise landing-rise-delay-1 mt-4 max-w-md text-lg leading-relaxed text-ink-2">{copy.sub}</p>
          <div className="landing-rise landing-rise-delay-2 mt-7 flex flex-col items-stretch gap-2 sm:flex-row sm:items-center sm:gap-4">
            {signedIn ? <LandingCta href="/home" label="Open Desk" wide /> : <LandingCta wide />}
            <a
              href="/pricing"
              className="inline-flex min-h-11 items-center justify-center rounded-xl px-3 text-base font-semibold text-[var(--landing-cta)] focus-visible:outline-none focus-visible:shadow-focus"
            >
              See pricing
            </a>
          </div>
        </div>
        <div className="relative min-w-0">
          <div className="landing-orbs" aria-hidden data-landing-orbs="" />
          <div className="relative">
            <HeroCall ask={copy.ask} />
          </div>
        </div>
      </section>

      <LandingMoments items={copy.moments} />
      <LandingHowItWorks />
      <LandingTrust />
      <LandingKeepNumber />
      <LandingPackages />
      <LandingQuestions />

      <section className="relative overflow-hidden px-5 pb-16 pt-6 sm:px-8" data-landing-final="">
        <div className="landing-glow pointer-events-none absolute inset-x-0 bottom-0 h-64" aria-hidden />
        <div className="relative mx-auto max-w-desk">
          <h2 className="font-display text-2xl tracking-tight text-ink sm:text-3xl">{copy.finalHeading}</h2>
          <div className="mt-6">{signedIn ? <LandingCta href="/home" label="Open Desk" /> : <LandingCta />}</div>
        </div>
      </section>

      <footer className="flex justify-center border-t border-hairline px-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-3">
        <AppearanceFooter />
      </footer>
    </main>
  );
}
