"use client";

import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { btnPrimary } from "@/components/ui/deskChrome";
import { DeskError } from "@/components/ui/DeskError";

/** Load failure stays on the page. Retry re-runs the server render. */
export function DeskLoadError({ children }: { children: ReactNode }) {
  const { refresh } = useRouter();

  return (
    <div>
      <DeskError>{children}</DeskError>
      <button type="button" onClick={() => refresh()} className={`${btnPrimary} mt-4`}>
        Retry
      </button>
    </div>
  );
}
