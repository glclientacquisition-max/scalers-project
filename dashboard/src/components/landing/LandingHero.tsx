import { AppMock } from "@/components/landing/AppMock";
import { HowItWorksLink, LandingCta } from "@/components/landing/LandingCta";

export function LandingHero() {
  return (
    <section className="landing-wash" aria-labelledby="hero-title">
      <div className="mx-auto grid max-w-desk items-center gap-10 px-4 py-10 sm:px-6 lg:grid-cols-2 lg:gap-16 lg:py-16">
        <div>
          <h1
            id="hero-title"
            className="landing-rise max-w-[20ch] font-display text-4xl font-semibold leading-[1.12] tracking-tight text-ink sm:text-5xl"
          >
            Your business assistant helps you run the business.
          </h1>
          <p className="landing-rise landing-rise-delay-1 mt-4 max-w-[65ch] text-base leading-7 text-ink-2">
            Answers when you cannot pick up, from your business knowledge. Notifies you by SMS, WhatsApp, and email. The work lives in the Scalers app.
          </p>
          <p className="landing-rise landing-rise-delay-2 mt-6 text-base text-ink-2">Private beta. Invite only.</p>
          <div className="landing-rise landing-rise-delay-3 mt-4 flex flex-col items-start gap-1 sm:flex-row sm:items-center sm:gap-4">
            <LandingCta size="lg" />
            <HowItWorksLink />
          </div>
        </div>
        <AppMock />
      </div>
    </section>
  );
}
