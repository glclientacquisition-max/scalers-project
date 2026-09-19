/**
 * Direct-call action. tel: deep link — the phone's own dialer places the call,
 * so it works on any device with no platform telephony involved.
 * List dock sibling of WhatsAppLink: muted tile, icon-only, same 44px hit area.
 * Glyph is a rounded handset in brand blue, not a desk telephone.
 */

import { DeskHint } from "@/components/ui/DeskHint";
import { deskHitClass, deskShiftClass } from "@/components/ui/deskChrome";

export function telHref(rawNumber: string): string | null {
  const digits = String(rawNumber || "").replace(/\D/g, "");
  if (digits.length < 9) return null;
  return `tel:+${digits}`;
}

function CallIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      data-icon="handset"
      className={className || "h-5 w-5"}
    >
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z" />
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
    <DeskHint label="Call" side="top">
      <a
        href={href}
        title="Call"
        aria-label={`Call ${number}`}
        className={[
          `${deskHitClass} border border-line bg-accent/[0.08] text-accent-deep`,
          `${deskShiftClass} hover:border-accent hover:bg-accent/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2`,
          className,
        ].join(" ")}
      >
        <CallIcon />
      </a>
    </DeskHint>
  );
}
