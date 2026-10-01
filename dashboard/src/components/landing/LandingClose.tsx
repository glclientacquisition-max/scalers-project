import Link from "next/link";
import { HowItWorksLink, LandingCta, SELL_URL } from "@/components/landing/LandingCta";

export function LandingClose() {
  return (
    <>
      <section className="landing-wash border-t border-hairline" aria-labelledby="close-title">
        <div className="mx-auto max-w-desk px-4 py-16 sm:px-6 lg:py-24">
          <h2 id="close-title" className="max-w-[16ch] font-display text-3xl font-semibold leading-tight tracking-tight text-ink sm:text-5xl">
            Put the phone on your business assistant.
          </h2>
          <p className="mt-4 max-w-[65ch] text-base leading-7 text-ink-2">Private beta. Invite only.</p>
          <div className="mt-8 flex flex-col items-start gap-1 sm:flex-row sm:items-center sm:gap-4">
            <LandingCta size="lg" />
            <HowItWorksLink />
          </div>
        </div>
      </section>
      <footer className="border-t border-hairline">
        <div className="mx-auto flex max-w-desk flex-col gap-4 px-4 py-8 sm:flex-row sm:items-end sm:justify-between sm:px-6">
          <div>
            <p className="font-display text-title text-ink">Scalers</p>
            <p className="mt-1 max-w-[65ch] text-base leading-7 text-ink-2">
              Business assistant, starting with voice and Desk.
            </p>
            <a
              href={SELL_URL}
              className="mt-2 inline-flex min-h-11 items-center text-base text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
            >
              scalers.co.ke
            </a>
          </div>
          <Link
            href="/login"
            className="inline-flex min-h-11 items-center text-base text-ink-2 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
          >
            Sign in
          </Link>
        </div>
      </footer>
    </>
  );
}
