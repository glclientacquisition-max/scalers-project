import { DeskMock } from "@/components/landing/DeskMock";
import { HowItWorksLink, LandingCta } from "@/components/landing/LandingCta";

export function LandingHero() {
  return (
    <section className="landing-wash" aria-labelledby="hero-title">
      <div className="mx-auto grid max-w-desk items-center gap-10 px-4 py-10 sm:px-6 lg:grid-cols-2 lg:gap-16 lg:py-16">
        <div>
          <p className="landing-rise text-base text-ink-2">Private beta. Invite only.</p>
          <h1
            id="hero-title"
            className="landing-rise landing-rise-delay-1 mt-3 max-w-[16ch] font-display text-4xl font-semibold leading-[1.12] tracking-tight text-ink sm:text-5xl"
          >
            Your business assistant answers when you cannot pick up.
          </h1>
          <p className="landing-rise landing-rise-delay-2 mt-4 max-w-[65ch] text-base leading-7 text-ink-2">
            Missed, busy, and after-hours calls are answered on your number. You train the facts and work the inbox in Desk.
          </p>
          <div className="landing-rise landing-rise-delay-3 mt-8 flex flex-col items-start gap-1 sm:flex-row sm:items-center sm:gap-4">
            <LandingCta size="lg" />
            <HowItWorksLink />
          </div>
        </div>
        <DeskMock />
      </div>
    </section>
  );
}
