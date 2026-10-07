/**
 * Direct-call action. tel: deep link — the phone's own dialer places the call,
 * so it works on any device with no platform telephony involved.
 * List dock sibling of WhatsAppLink: 44px circular IconButton, never filled.
 */

import { PhoneIcon } from "@heroicons/react/24/outline";
import { IconButtonAnchor } from "@/components/ui/IconButton";

export function telHref(rawNumber: string): string | null {
  const digits = String(rawNumber || "").replace(/\D/g, "");
  if (digits.length < 9) return null;
  return `tel:+${digits}`;
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
    <IconButtonAnchor
      href={href}
      label={`Call ${number}`}
      tone="accent"
      size="sm"
      className={className}
    >
      <PhoneIcon aria-hidden="true" data-icon="handset" />
    </IconButtonAnchor>
  );
}
