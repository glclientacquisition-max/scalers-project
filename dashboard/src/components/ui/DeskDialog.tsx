"use client";

import type { ReactNode } from "react";
import { Sheet } from "@/components/ui/Sheet";

/**
 * Owner overlay. Renders the Sheet drawer. Swipe down, the scrim, and Escape
 * close it. A pending submit keeps it open. No enter animation on the verbs
 * outside this drawer.
 */
export function DeskDialog({
  open,
  title,
  onClose,
  pending = false,
  panelClassName = "max-w-md",
  children,
}: {
  open: boolean;
  title: string;
  titleId?: string;
  onClose: () => void;
  pending?: boolean;
  panelClassName?: string;
  children: ReactNode;
}) {
  const wide = /max-w-(lg|xl|2xl|3xl|4xl)/.test(panelClassName);

  return (
    <Sheet
      open={open}
      dismissible={!pending}
      size={wide ? "lg" : "md"}
      title={title}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      {children}
    </Sheet>
  );
}
