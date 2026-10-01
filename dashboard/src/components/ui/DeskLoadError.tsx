"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { btnPrimary, deskShiftClass, focusRingVisible } from "@/components/ui/deskChrome";
import { DeskError } from "@/components/ui/DeskError";

/** Load failure stays on the page. Retry re-runs the server render. */
export function DeskLoadError({
  children,
  backHref,
  backLabel,
}: {
  children: ReactNode;
  /** Muted text link. Lists omit it. Retry stays the filled action. */
  backHref?: string;
  backLabel?: string;
}) {
  const { refresh } = useRouter();

  return (
    <div>
      <DeskError>{children}</DeskError>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button type="button" onClick={() => refresh()} className={btnPrimary}>
          Retry
        </button>
        {backHref && backLabel ? (
          <Link
            href={backHref}
            className={`inline-flex min-h-11 items-center px-1 text-sm font-medium text-ink-soft ${deskShiftClass} hover:underline ${focusRingVisible}`}
          >
            {backLabel}
          </Link>
        ) : null}
      </div>
    </div>
  );
}
