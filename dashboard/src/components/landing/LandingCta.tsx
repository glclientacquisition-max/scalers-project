import { ButtonLink, type ButtonSize } from "@/components/ui/Button";

/** One primary label. Repeated in the nav, hero, mid-page, FAQ, and close. */
export const PRIMARY_CTA = "Request beta access";
export const PRIMARY_HREF = "/signup";
export const SELL_URL = "https://scalers.co.ke";

const focus =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-canvas";

export function LandingCta({ size = "md" }: { size?: ButtonSize }) {
  return (
    <ButtonLink href={PRIMARY_HREF} size={size}>
      {PRIMARY_CTA}
    </ButtonLink>
  );
}

export function HowItWorksLink() {
  return (
    <a
      href="#how"
      className={`inline-flex min-h-11 items-center rounded-md px-1 text-base font-medium text-accent ${focus}`}
    >
      See how it works
    </a>
  );
}
