"use client";

import { Tooltip as BaseTooltip } from "@base-ui/react/tooltip";
import type { ReactElement, ReactNode } from "react";

/**
 * Name for an icon-only control. Shows on hover and keyboard focus.
 * Wrap a screen (or the shell) in `TooltipProvider` so the second tooltip opens instantly.
 */
export function TooltipProvider({ children }: { children: ReactNode }) {
  return (
    <BaseTooltip.Provider delay={400} closeDelay={0} timeout={300}>
      {children}
    </BaseTooltip.Provider>
  );
}

export function Tooltip({
  label,
  children,
  side = "top",
}: {
  label: string;
  /** The trigger element. Must accept a ref and DOM props. */
  children: ReactElement;
  side?: "top" | "bottom" | "left" | "right";
}) {
  return (
    <BaseTooltip.Root>
      <BaseTooltip.Trigger render={children} />
      <BaseTooltip.Portal>
        <BaseTooltip.Positioner side={side} sideOffset={6} className="z-menu">
          <BaseTooltip.Popup className="origin-[var(--transform-origin)] rounded-md bg-ink px-2 py-1 text-caption font-medium text-canvas shadow-menu transition-[opacity,transform] duration-fast ease-out data-[ending-style]:scale-95 data-[ending-style]:opacity-0 data-[starting-style]:scale-95 data-[starting-style]:opacity-0 data-[instant]:duration-0 motion-reduce:transition-none">
            {label}
          </BaseTooltip.Popup>
        </BaseTooltip.Positioner>
      </BaseTooltip.Portal>
    </BaseTooltip.Root>
  );
}
