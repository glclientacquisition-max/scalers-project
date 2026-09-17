/**
 * Direct-call action. tel: deep link — the phone's own dialer places the call,
 * so it works on any device with no platform telephony involved.
 * List dock sibling of WhatsAppLink: muted, icon-only, same 44px hit area.
 */

import { deskShiftClass } from "@/components/ui/deskChrome";

export function telHref(rawNumber: string): string | null {
  const digits = String(rawNumber || "").replace(/\D/g, "");
  if (digits.length < 9) return null;
  return `tel:+${digits}`;
}

function PhoneIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      className={className || "h-5 w-5"}
    >
      <path d="M1.5 4.5a3 3 0 0 1 3-3h1.372c.86 0 1.61.586 1.819 1.42l1.105 4.423a1.875 1.875 0 0 1-.564 1.875l-.97.97a.563.563 0 0 0-.128.598 11.995 11.995 0 0 0 6.132 6.132.563.563 0 0 0 .598-.128l.97-.97a1.875 1.875 0 0 1 1.875-.564l4.423 1.105c.834.209 1.42.959 1.42 1.819V19.5a3 3 0 0 1-3 3h-2.25C8.552 22.5 1.5 15.448 1.5 6.75V4.5Z" />
    </svg>
  );
}

export function CallLink({
  number,
  className = "",
}: {
  number: string;
  className?: string;
}) {
  const href = telHref(number);
  if (!href) return null;
  return (
    <a
      href={href}
      title={`Call ${number}`}
      aria-label={`Call ${number}`}
      className={[
        "inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-line text-ink",
        `${deskShiftClass} hover:border-accent hover:text-accent-deep focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2`,
        className,
      ].join(" ")}
    >
      <PhoneIcon />
    </a>
  );
}
