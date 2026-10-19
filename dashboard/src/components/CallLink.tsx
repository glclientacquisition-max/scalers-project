/**
 * Direct-call action. Phones and tablets: tel: deep link, the device dialer places the call.
 * Desktop (fine pointer): copies the number and shows "Number copied".
 * List dock sibling of WhatsAppLink: 44px circular IconButton, never filled.
 */

"use client";

import type { MouseEvent } from "react";
import { PhoneIcon } from "@heroicons/react/24/outline";
import { IconButtonAnchor } from "@/components/ui/IconButton";
import { notify } from "@/components/ui/DeskNotice";
import { kePhoneDigits } from "@/lib/kePhone";

export function telHref(rawNumber: string): string | null {
  const digits = kePhoneDigits(rawNumber);
  return digits ? `tel:+${digits}` : null;
}

async function copyNumber(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function onDesktopCall(event: MouseEvent<HTMLAnchorElement>, number: string) {
  if (typeof window === "undefined" || !window.matchMedia) return;
  if (window.matchMedia("(pointer: coarse)").matches) return;
  event.preventDefault();
  void copyNumber(number).then((ok) => notify(ok ? "Number copied" : `Call ${number}`));
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
  const e164 = href.slice("tel:".length);
  return (
    <IconButtonAnchor
      href={href}
      label={`Call ${number}`}
      tone="accent"
      size="sm"
      className={className}
      onClick={(event) => onDesktopCall(event, e164)}
    >
      <PhoneIcon aria-hidden="true" data-icon="handset" />
    </IconButtonAnchor>
  );
}
