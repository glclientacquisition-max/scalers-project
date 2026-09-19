import Link from "next/link";
import { DeskHint } from "@/components/ui/DeskHint";
import { deskShiftClass } from "@/components/ui/deskChrome";

function BackChevron() {
  return (
    <svg viewBox="0 0 16 16" className="h-5 w-5" fill="none" aria-hidden="true">
      <path
        d="M10.2 3.2 5.4 8l4.8 4.8"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Previous screen. Icon-only chevron. 44px muted ghost. Label is aria-label from the destination. */
export function DeskBack({
  href,
  children,
  className,
}: {
  href: string;
  children: string;
  className?: string;
}) {
  return (
    <DeskHint label={children} side="top">
      <Link
        href={href}
        aria-label={children}
        title={children}
        className={[
          "inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-xl text-ink-soft",
          deskShiftClass,
          "hover:bg-surface-muted hover:text-ink",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
          className,
        ]
          .filter(Boolean)
          .join(" ")}
      >
        <BackChevron />
      </Link>
    </DeskHint>
  );
}
