import { appEntryHref } from "@/lib/adminHost";

/** Landing CTA copy. Decision 30 Oct: access is by request, no open self sign-up from marketing. */
export const LANDING_CTA_LABEL = "Request access";

/**
 * The one primary action on marketing pages. Colour comes from the landing-only token (--landing-cta,
 * globals.css .landing-scope), so the accent can be swapped in one place and never leaks into the Desk.
 */
export function LandingCta({
  href = "/signup",
  label = LANDING_CTA_LABEL,
  size = "lg",
}: {
  href?: string;
  label?: string;
  size?: "md" | "lg";
}) {
  const pad = size === "lg" ? "min-h-12 px-6 text-base" : "min-h-11 px-4 text-sm";
  return (
    <a
      href={appEntryHref(href)}
      data-landing-cta=""
      className={`landing-cta inline-flex items-center justify-center whitespace-nowrap rounded-xl font-semibold transition-colors focus-visible:outline-none focus-visible:shadow-focus ${pad}`}
    >
      {label}
    </a>
  );
}
