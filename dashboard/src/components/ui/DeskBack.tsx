import Link from "next/link";
import { deskShiftClass } from "@/components/ui/deskChrome";

/** Previous screen. 44px hit. Label is that screen: Inbox, Call, Contacts. */
export function DeskBack({ href, children }: { href: string; children: string }) {
  return (
    <Link
      href={href}
      className={`sticky top-[var(--desk-header-h)] z-20 inline-flex min-h-11 items-center bg-surface-canvas/95 text-sm font-medium text-accent-deep ${deskShiftClass} hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent`}
    >
      {children}
    </Link>
  );
}
