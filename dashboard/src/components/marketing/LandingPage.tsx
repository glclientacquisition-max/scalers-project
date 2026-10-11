import Image from "next/image";
import { appEntryHref } from "@/lib/adminHost";
import { brandAssets } from "@/components/brand/assets";
import { HeroCall, HowStage } from "@/components/marketing/LandingStory";
import { ThemeDock } from "@/components/ThemePicker";

/**
 * Marketing home: hero, how it works, then sign up.
 * Package prices stay off this page until pricing is ready.
 * Authenticated owners get a direct path back to their workspace.
 */
export function LandingPage({
  signedIn = false,
}: {
  signedIn?: boolean;
}) {
  const actionHref = signedIn ? "/home" : "/signup";
  const actionLabel = signedIn ? "Dashboard" : "Sign up";
  return (
    <main>
      <section className="relative min-h-dvh overflow-hidden">
      {/* Full-bleed brand visual plane */}
      <div className="pointer-events-none absolute inset-0" aria-hidden>
        <div className="absolute inset-0 bg-brand-900" />
        <div
          className="absolute inset-0 opacity-[0.22] landing-drift"
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

      <div className="relative z-10 mx-auto flex min-h-dvh max-w-desk flex-col px-6 pb-10 pt-6 sm:px-8">
        <header className="glass-chrome flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-white/15 px-3 py-2 landing-rise">
          <span className="shrink-0 font-display text-base tracking-tight text-white sm:text-xl">
            Scalers
          </span>
          <nav className="flex shrink-0 items-center gap-1 sm:gap-2">
            <ThemeDock tone="onDark" />
            {signedIn ? (
              <a
                href={appEntryHref(actionHref)}
                className="inline-flex min-h-11 items-center whitespace-nowrap rounded-xl bg-white px-3 text-sm font-medium text-brand-900 hover:bg-brand-50 focus-visible:outline-none focus-visible:shadow-focus sm:px-4"
              >
                {actionLabel}
              </a>
            ) : (
              <>
                <a
                  href={appEntryHref("/login")}
                  className="inline-flex min-h-11 items-center whitespace-nowrap rounded-xl px-2 text-sm font-medium text-white/85 hover:text-white focus-visible:outline-none focus-visible:shadow-focus sm:px-3"
                >
                  Sign in
                </a>
                <a
                  href={appEntryHref(actionHref)}
                  className="inline-flex min-h-11 items-center whitespace-nowrap rounded-xl bg-white px-3 text-sm font-medium text-brand-900 hover:bg-brand-50 focus-visible:outline-none focus-visible:shadow-focus sm:px-4"
                >
                  {actionLabel}
                </a>
              </>
            )}
          </nav>
        </header>

        <section className="grid flex-1 items-stretch gap-10 py-12 lg:grid-cols-2 lg:grid-rows-[minmax(28rem,1fr)] lg:gap-12 lg:py-16">
          <div className="max-w-xl min-w-0 self-center">
            <div className="landing-rise landing-rise-delay-1 flex items-center gap-3">
              <span className="relative inline-flex h-14 w-14 shrink-0 sm:h-16 sm:w-16">
                <Image
                  src={brandAssets.iconTransparent}
                  alt=""
                  width={64}
                  height={64}
                  priority
                  className="h-full w-full object-contain"
                />
              </span>
              <p className="font-display text-4xl tracking-tight text-white sm:text-5xl md:text-6xl">
                Scalers
              </p>
            </div>

            <h1 className="landing-rise landing-rise-delay-2 mt-8 font-display text-3xl leading-tight tracking-tight text-white sm:text-4xl md:text-[2.75rem] text-balance">
              Your 24-hour call assistant, so you do not miss the client.
            </h1>

            <p className="landing-rise landing-rise-delay-3 mt-4 max-w-md text-base leading-relaxed text-sky-100/90 sm:text-lg">
              It answers when you are busy, after hours, on another call, or the line is off.
            </p>

            <p className="landing-rise landing-rise-delay-3 mt-3 max-w-md text-sm leading-relaxed text-sky-100/65">
              Scalers is a business assistant that actually helps you run the business, from the
              client call through to the booking, the order, or whatever comes next.
            </p>

            <div className="landing-rise landing-rise-delay-4 mt-10 flex flex-wrap items-center gap-3">
              <a
                href={appEntryHref(actionHref)}
                className="inline-flex min-h-12 items-center justify-center rounded-xl bg-white px-6 py-3 text-base font-medium text-brand-900 transition hover:bg-brand-50 focus-visible:outline-none focus-visible:shadow-focus"
              >
                {actionLabel}
              </a>
              {!signedIn ? (
                <a
                  href={appEntryHref("/login")}
                  className="inline-flex min-h-12 items-center justify-center rounded-xl border border-white/30 px-6 py-3 text-base font-medium text-white transition hover:border-white/55 hover:bg-white/5 focus-visible:outline-none focus-visible:shadow-focus"
                >
                  Sign in
                </a>
              ) : null}
            </div>
          </div>
          <HeroCall />
        </section>

      </div>
      </section>

      <section className="bg-canvas px-6 py-16 text-ink sm:px-8">
        <div className="mx-auto max-w-desk">
          <h2 className="font-display text-display text-ink">How it works</h2>
          <HowStage />
        </div>
      </section>

      <section className="bg-canvas px-6 pb-20 pt-4 text-ink sm:px-8">
        <div className="mx-auto max-w-desk">
          <div className="max-w-xl">
            <p className="text-base leading-relaxed text-ink">
              Scalers is a business assistant that actually helps you run the business, from the
              client call through to the booking, the order, or whatever comes next.
            </p>
            <a
              href={appEntryHref(actionHref)}
              className="mt-6 inline-flex min-h-12 items-center justify-center rounded-xl bg-brand-900 px-6 py-3 text-base font-medium text-white transition hover:bg-brand-800 focus-visible:outline-none focus-visible:shadow-focus"
            >
              {actionLabel}
            </a>
          </div>
        </div>
      </section>
    </main>
  );
}
