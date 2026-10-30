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
import { LandingCta } from "@/components/marketing/LandingCta";
import { AppearanceFooter } from "@/components/ThemePicker";

/**
 * Marketing home on the light canvas. One job: request access. The warm accent (landing token) is on the
 * primary CTA only, with a faint glow of the same colour behind the hero call card and the final CTA.
 * Signed-in owners get a way back to their Desk instead.
 */
export function LandingPage({ signedIn = false }: { signedIn?: boolean }) {
  return (
    <main className="landing-scope overflow-x-clip bg-canvas text-ink" data-landing="">
      <header className="mx-auto flex max-w-desk items-center justify-between gap-2 px-5 pt-[max(1rem,env(safe-area-inset-top))] sm:px-8">
        <BrandWordmark href="/" context="Home" variant="lockup" priority />
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
          <h1 className="landing-rise font-display text-[2rem] leading-[1.12] tracking-tight text-ink text-balance sm:text-5xl">
            Your calls get answered, even when you can&apos;t.
          </h1>
          <p className="landing-rise landing-rise-delay-1 mt-4 text-base leading-relaxed text-ink-2 sm:text-lg">
            On a job, on another call, or closed for the night. Your Business Assistant answers with your prices and
            hours, then texts you the details.
          </p>
          <div className="landing-rise landing-rise-delay-2 mt-7 flex flex-wrap items-center gap-3">
            {signedIn ? <LandingCta href="/home" label="Open Desk" /> : <LandingCta />}
          </div>
          <p className="landing-rise landing-rise-delay-3 mt-4 text-sm text-ink-2" data-landing-trust="">
            Keep your number. Turn it off with one code.
          </p>
        </div>
        <div className="relative min-w-0">
          <div className="landing-glow pointer-events-none absolute -inset-8" aria-hidden />
          <HeroCall />
        </div>
      </section>

      <LandingMoments />
      <LandingHowItWorks />
      <LandingTrust />
      <LandingKeepNumber />
      <LandingPackages />
      <LandingQuestions />

      <section className="relative overflow-hidden px-5 pb-16 pt-6 sm:px-8" data-landing-final="">
        <div className="landing-glow pointer-events-none absolute inset-x-0 bottom-0 h-64" aria-hidden />
        <div className="relative mx-auto max-w-desk">
          <h2 className="font-display text-2xl tracking-tight text-ink sm:text-3xl">Stop losing jobs to missed calls.</h2>
          <div className="mt-6">{signedIn ? <LandingCta href="/home" label="Open Desk" /> : <LandingCta />}</div>
        </div>
      </section>

      <footer className="flex justify-center border-t border-hairline px-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-3">
        <AppearanceFooter />
      </footer>
    </main>
  );
}
