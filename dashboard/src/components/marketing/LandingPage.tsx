import Image from "next/image";
import Link from "next/link";
import { brandAssets } from "@/components/brand/assets";
import { HeroCall, HowStage } from "@/components/marketing/LandingStory";
import { PackagePrices } from "@/components/marketing/PackagePrices";
import { emptyPublicBoard, type PublicPackageBoard } from "@/lib/packageCatalog";

/**
 * Marketing home: hero, how it works, then the package table.
 * Authenticated owners get a direct path back to their workspace.
 */
export function LandingPage({
  board,
  signedIn = false,
}: {
  board?: PublicPackageBoard;
  signedIn?: boolean;
}) {
  const offers = board ?? emptyPublicBoard();
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
        <header className="flex items-center justify-between gap-4 landing-rise">
          <span className="font-display text-lg tracking-tight text-white sm:text-xl">
            Scalers
          </span>
          <nav className="flex items-center gap-2">
            <a
              href="#packages"
              className="inline-flex min-h-11 items-center rounded-xl px-3 text-sm font-medium text-white/85 hover:text-white focus-visible:outline-none focus-visible:shadow-focus"
            >
              Packages
            </a>
            {signedIn ? (
              <Link
                href={actionHref}
                className="inline-flex min-h-11 items-center rounded-xl bg-white px-4 text-sm font-medium text-brand-900 hover:bg-brand-50 focus-visible:outline-none focus-visible:shadow-focus"
              >
                {actionLabel}
              </Link>
            ) : (
              <>
                <Link
                  href="/login"
                  className="inline-flex min-h-11 items-center rounded-xl px-3 text-sm font-medium text-white/85 hover:text-white focus-visible:outline-none focus-visible:shadow-focus"
                >
                  Sign in
                </Link>
                <Link
                  href={actionHref}
                  className="inline-flex min-h-11 items-center rounded-xl bg-white px-4 text-sm font-medium text-brand-900 hover:bg-brand-50 focus-visible:outline-none focus-visible:shadow-focus"
                >
                  {actionLabel}
                </Link>
              </>
            )}
          </nav>
        </header>

        <section className="grid flex-1 items-center gap-12 py-16 lg:grid-cols-[minmax(0,36rem)_minmax(16rem,1fr)] sm:py-20">
          <div className="max-w-xl">
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

            <h1 className="landing-rise landing-rise-delay-2 mt-8 font-display text-3xl leading-tight tracking-tight text-white sm:text-4xl md:text-[2.75rem]">
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
              <Link
                href={actionHref}
                className="inline-flex min-h-12 items-center justify-center rounded-xl bg-white px-6 py-3 text-base font-medium text-brand-900 transition hover:bg-brand-50 focus-visible:outline-none focus-visible:shadow-focus"
              >
                {actionLabel}
              </Link>
              {!signedIn ? (
                <Link
                  href="/login"
                  className="inline-flex min-h-12 items-center justify-center rounded-xl border border-white/30 px-6 py-3 text-base font-medium text-white transition hover:border-white/55 hover:bg-white/5 focus-visible:outline-none focus-visible:shadow-focus"
                >
                  Sign in
                </Link>
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
          <HowStage>
          <ol className="max-w-xl space-y-5 text-base leading-relaxed text-ink">
            <li className="flex gap-4">
              <span className="font-display text-ink-soft">1</span>
              <span>You set the business in the Desk: who you are, hours, services, and the answers.</span>
            </li>
            <li className="flex gap-4">
              <span className="font-display text-ink-soft">2</span>
              <span>The assistant takes the call.</span>
            </li>
            <li className="flex gap-4">
              <span className="font-display text-ink-soft">3</span>
              <span>You get SMS, WhatsApp, or email, then work it in the inbox: call back, WhatsApp, or an SMS you approve.</span>
            </li>
          </ol>
          </HowStage>
          <div className="mt-10">
            <Link
              href={actionHref}
              className="inline-flex min-h-12 items-center justify-center rounded-xl bg-brand-900 px-6 py-3 text-base font-medium text-white transition hover:bg-brand-800 focus-visible:outline-none focus-visible:shadow-focus"
            >
              {actionLabel}
            </Link>
          </div>
        </div>
      </section>

      <section id="packages" className="bg-canvas px-6 py-16 text-ink sm:px-8">
        <div className="mx-auto max-w-desk">
          <PackagePrices board={offers} actionHref={actionHref} actionLabel={actionLabel} />
        </div>
      </section>
    </main>
  );
}
