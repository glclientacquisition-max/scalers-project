import Image from "next/image";
import { appEntryHref } from "@/lib/adminHost";
import { brandAssets } from "@/components/brand/assets";
import { HeroCall, HowStage } from "@/components/marketing/LandingStory";
import { LandingCta } from "@/components/marketing/LandingCta";
import { AppearanceFooter } from "@/components/ThemePicker";

/**
 * Marketing home. The hero is main's dark navy plane (30 Oct v3, Alvin) with a frosted call card and one soft orange
 * glow behind it; orange is used nowhere else. The rest of the page stays on the light canvas with blue buttons.
 * One job: request access. Short words: one headline, one line, one button.
 * Signed-in owners get a way back to their Desk instead.
 */
export function LandingPage({ signedIn = false }: { signedIn?: boolean }) {
  return (
    <main className="landing-scope overflow-x-clip bg-canvas text-ink" data-landing="">
      <div className="relative isolate overflow-hidden bg-brand-900 text-white" data-landing-hero="">
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
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a
            href="/"
            aria-label="Scalers home"
            className="inline-flex min-h-11 items-center gap-2 rounded-xl focus-visible:outline-none focus-visible:shadow-focus"
          >
            <Image src={brandAssets.iconTransparent} alt="" width={36} height={36} priority className="h-9 w-9 object-contain" />
            <span className="font-display text-xl tracking-tight text-white">Scalers</span>
          </a>
          <nav className="flex shrink-0 items-center gap-1">
            {signedIn ? (
              <a
                href={appEntryHref("/home")}
                className="inline-flex min-h-11 items-center rounded-xl px-3 text-sm font-medium text-white focus-visible:outline-none focus-visible:shadow-focus"
              >
                Open Desk
              </a>
            ) : (
              <a
                href={appEntryHref("/login")}
                className="inline-flex min-h-11 items-center rounded-xl px-3 text-sm font-medium text-white/85 hover:text-white focus-visible:outline-none focus-visible:shadow-focus"
              >
                Sign in
              </a>
            )}
          </nav>
        </header>

        <section className="mx-auto grid max-w-desk items-center gap-10 px-5 pb-16 pt-8 sm:px-8 lg:grid-cols-[1.1fr_1fr] lg:gap-14 lg:pb-24 lg:pt-14">
          <div className="min-w-0 max-w-xl">
            <h1 className="landing-rise font-display text-[2.25rem] leading-[1.1] tracking-tight text-white text-balance sm:text-5xl lg:text-6xl">
              Your 24-hour Business Assistant.
            </h1>
            <p className="landing-rise landing-rise-delay-1 mt-4 max-w-md text-lg leading-relaxed text-sky-100/90">Answers your calls when you&apos;re busy, closed, or on another call.</p>
            <div className="landing-rise landing-rise-delay-2 mt-7 flex flex-col items-stretch gap-3 sm:flex-row sm:items-center">
              {signedIn ? <LandingCta href="/home" label="Open Desk" tone="onDark" wide /> : <LandingCta tone="onDark" wide />}
              <a
                href="/pricing"
                className="inline-flex min-h-[3.25rem] items-center justify-center rounded-xl border border-white/30 px-6 text-base font-semibold text-white transition-colors hover:border-white/55 hover:bg-white/5 focus-visible:outline-none focus-visible:shadow-focus"
              >
                See pricing
              </a>
            </div>
          </div>
          <div className="relative min-w-0">
            <div className="landing-warm-orb" aria-hidden data-landing-warm="" />
            <div className="relative">
              <HeroCall glass />
            </div>
          </div>
        </section>
      </div>

      <section className="px-5 py-14 sm:px-8">
        <div className="mx-auto max-w-desk">
          <h2 className="font-display text-2xl tracking-tight text-ink sm:text-3xl">How it works</h2>
          <HowStage />
        </div>
      </section>

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
