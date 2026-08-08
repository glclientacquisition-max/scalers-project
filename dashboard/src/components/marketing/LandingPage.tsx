import Image from "next/image";
import Link from "next/link";
import { brandAssets } from "@/components/brand/assets";

/**
 * Logged-out marketing home — one hero composition:
 * brand → value → single CTA group. Authenticated users never see this.
 */
export function LandingPage() {
  return (
    <main className="relative min-h-screen overflow-hidden">
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

      <div className="relative z-10 mx-auto flex min-h-screen max-w-desk flex-col px-6 pb-10 pt-6 sm:px-8">
        <header className="flex items-center justify-between gap-4 landing-rise">
          <span className="font-display text-lg tracking-tight text-white sm:text-xl">
            Scalers
          </span>
          <Link
            href="/login"
            className="rounded-xl px-3 py-2 text-sm font-medium text-white/85 transition hover:text-white focus-visible:outline-none focus-visible:shadow-focus"
          >
            Sign in
          </Link>
        </header>

        <section className="flex flex-1 flex-col justify-center py-16 sm:py-20">
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
              Your receptionist answers every missed call.
            </h1>

            <p className="landing-rise landing-rise-delay-3 mt-4 max-w-md text-base leading-relaxed text-sky-100/90 sm:text-lg">
              Capture the caller&apos;s name and reason, then get the lead on WhatsApp — busy,
              after hours, or mid-job.
            </p>

            <div className="landing-rise landing-rise-delay-4 mt-10 flex flex-wrap items-center gap-3">
              <Link
                href="/signup"
                className="inline-flex min-h-12 items-center justify-center rounded-xl bg-white px-6 py-3 text-base font-medium text-brand-900 transition hover:bg-brand-50 focus-visible:outline-none focus-visible:shadow-focus"
              >
                Create workspace
              </Link>
              <Link
                href="/login"
                className="inline-flex min-h-12 items-center justify-center rounded-xl border border-white/30 px-6 py-3 text-base font-medium text-white transition hover:border-white/55 hover:bg-white/5 focus-visible:outline-none focus-visible:shadow-focus"
              >
                Sign in
              </Link>
            </div>
          </div>
        </section>

        <p className="landing-rise landing-rise-delay-4 text-xs text-sky-100/55 sm:text-sm">
          Built for East African businesses that can&apos;t afford a missed lead.
        </p>
      </div>
    </main>
  );
}
