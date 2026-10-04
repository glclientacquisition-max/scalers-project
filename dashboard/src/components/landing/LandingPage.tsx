import { Faq } from "@/components/landing/Faq";
import { HowItWorks } from "@/components/landing/HowItWorks";
import { LandingClose } from "@/components/landing/LandingClose";
import { LandingHero } from "@/components/landing/LandingHero";
import { LandingNav } from "@/components/landing/LandingNav";
import { Outcomes } from "@/components/landing/Outcomes";
import { Problem } from "@/components/landing/Problem";
import { Proof } from "@/components/landing/Proof";

/** Logged-out marketing home. Signed-in owners never see this. */
export function LandingPage() {
  return (
    <>
      <LandingNav />
      <main id="main">
        <LandingHero />
        <Problem />
        <HowItWorks />
        <Outcomes />
        <Proof />
        <Faq />
        <LandingClose />
      </main>
    </>
  );
}
