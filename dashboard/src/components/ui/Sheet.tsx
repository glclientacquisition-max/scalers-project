"use client";

import { Drawer } from "@base-ui/react/drawer";
import { XMarkIcon } from "@heroicons/react/24/outline";
import type { ReactNode } from "react";
import { cx } from "@/lib/cx";

/**
 * Bottom drawer at every width. The finger tracks the panel 1:1. A downward
 * flick, or a drag past halfway, dismisses it along the same path it entered.
 * From `sm` the panel is width-capped and centered. Focus trap, Escape, and
 * scroll lock come from Base UI. No motion package.
 */
export function Sheet({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  size = "md",
  dismissible = true,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  /** Actions. Rendered as a row, primary last. */
  footer?: ReactNode;
  size?: "md" | "lg";
  /** When false, swipe, scrim, and Escape leave the drawer open. */
  dismissible?: boolean;
}) {
  return (
    <Drawer.Root
      open={open}
      swipeDirection="down"
      disablePointerDismissal={!dismissible}
      onOpenChange={(next, details) => {
        if (!next && !dismissible) {
          details.cancel();
          return;
        }
        onOpenChange(next);
      }}
    >
      <Drawer.VirtualKeyboardProvider>
        <Drawer.Portal>
          <Drawer.Backdrop className="desk-drawer-backdrop fixed inset-0 z-sheet motion-reduce:transition-none" />
          <Drawer.Viewport className="pointer-events-none fixed inset-0 z-sheet flex items-end justify-center">
            <Drawer.Popup
              className={cx(
                "desk-drawer glass-chrome pointer-events-auto flex max-h-[85dvh] w-full flex-col rounded-t-2xl text-ink shadow-sheet outline-none motion-reduce:transition-none",
                "sm:mb-4 sm:rounded-2xl",
                size === "lg" ? "sm:max-w-2xl" : "sm:max-w-md",
              )}
            >
              <div className="flex h-6 items-center justify-center" aria-hidden="true">
                <span className="h-1 w-9 rounded-full bg-ink-3" />
              </div>
              <div className="flex items-start gap-3 px-5 sm:px-6">
                <div className="min-w-0 flex-1">
                  <Drawer.Title className="text-title text-ink">{title}</Drawer.Title>
                  {description ? (
                    <Drawer.Description className="mt-1 text-meta text-ink-2">{description}</Drawer.Description>
                  ) : null}
                </div>
                <Drawer.Close
                  aria-label="Close"
                  className="-me-2 -mt-1 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-ink-2 hover:bg-surface-2 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                >
                  <XMarkIcon className="h-6 w-6" aria-hidden="true" />
                </Drawer.Close>
              </div>
              <Drawer.Content className="min-h-0 flex-1 overflow-y-auto px-5 py-4 sm:px-6">{children}</Drawer.Content>
              {footer ? (
                <div
                  className="flex flex-wrap items-center justify-end gap-2 border-t border-hairline px-5 py-4 sm:px-6"
                  style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom), var(--drawer-keyboard-inset, 0px))" }}
                >
                  {footer}
                </div>
              ) : (
                <div className="h-[max(1rem,env(safe-area-inset-bottom))] sm:h-4" />
              )}
            </Drawer.Popup>
          </Drawer.Viewport>
        </Drawer.Portal>
      </Drawer.VirtualKeyboardProvider>
    </Drawer.Root>
  );
}

export const SheetTrigger = Drawer.Trigger;
export const SheetClose = Drawer.Close;
