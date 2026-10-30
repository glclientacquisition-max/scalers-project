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
  wide = false,
  tone = "light",
}: {
  href?: string;
  label?: string;
  size?: "md" | "lg";
  /** Full width on phones (Fitts: one big target under the thumb), natural width from sm up. */
  wide?: boolean;
  /** onDark: white button with navy text for the dark hero (main's look). */
  tone?: "light" | "onDark";
}) {
  const pad = size === "lg" ? "min-h-[3.25rem] px-6 text-base" : "min-h-11 px-4 text-sm";
  const width = wide ? "w-full sm:w-auto" : "";
  return (
    <a
      href={appEntryHref(href)}
      data-landing-cta=""
      className={`${tone === "onDark" ? "landing-cta-on-dark" : "landing-cta"} landing-focus inline-flex items-center justify-center whitespace-nowrap rounded-xl font-semibold transition-colors ${pad} ${width}`}
    >
      {label}
    </a>
  );
}
