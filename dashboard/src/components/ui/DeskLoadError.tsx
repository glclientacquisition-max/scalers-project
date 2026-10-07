"use client";

import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { Button, ButtonLink } from "@/components/ui/Button";
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
        <Button type="button" onClick={() => refresh()}>
          Retry
        </Button>
        {backHref && backLabel ? (
          <ButtonLink href={backHref} variant="ghost">
            {backLabel}
          </ButtonLink>
        ) : null}
      </div>
    </div>
  );
}
