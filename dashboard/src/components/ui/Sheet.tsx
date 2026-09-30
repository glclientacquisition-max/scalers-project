"use client";

import { Dialog } from "@base-ui/react/dialog";
import { XMarkIcon } from "@heroicons/react/24/outline";
import type { ReactNode } from "react";
import { cx } from "@/lib/cx";

/**
 * One component for phone and desktop. Below `sm` it is a bottom sheet over the tab bar (the scrim
 * covers the tabs, as on iOS and Android); from `sm` it is a centered dialog. Focus trap, Escape, scroll lock, and outside-press come from Base UI.
 */
export function Sheet({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  size = "md",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  /** Actions. Rendered as a row, primary last. */
  footer?: ReactNode;
  size?: "md" | "lg";
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-sheet bg-ink/40 transition-opacity duration-sheet ease-out data-[ending-style]:opacity-0 data-[starting-style]:opacity-0 motion-reduce:transition-none" />
        <Dialog.Popup
          className={cx(
            "fixed inset-x-0 bottom-0 z-sheet flex max-h-[85dvh] flex-col rounded-t-2xl bg-surface text-ink shadow-sheet outline-none",
            "transition-[opacity,transform] duration-sheet ease-out data-[ending-style]:translate-y-4 data-[ending-style]:opacity-0 data-[starting-style]:translate-y-4 data-[starting-style]:opacity-0 motion-reduce:transition-none",
            "sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:w-full sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl sm:data-[ending-style]:scale-95 sm:data-[ending-style]:translate-y-[-50%] sm:data-[starting-style]:scale-95 sm:data-[starting-style]:translate-y-[-50%]",
            size === "lg" ? "sm:max-w-2xl" : "sm:max-w-md",
          )}
        >
          <div className="flex items-start gap-3 px-5 pt-5 sm:px-6 sm:pt-6">
            <div className="min-w-0 flex-1">
              <Dialog.Title className="text-title text-ink">{title}</Dialog.Title>
              {description ? (
                <Dialog.Description className="mt-1 text-meta text-ink-2">{description}</Dialog.Description>
              ) : null}
            </div>
            <Dialog.Close
              aria-label="Close"
              className="-me-2 -mt-2 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-ink-2 transition-colors duration-fast hover:bg-surface-2 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
            >
              <XMarkIcon className="h-6 w-6" aria-hidden="true" />
            </Dialog.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 sm:px-6">{children}</div>
          {footer ? (
            <div className="flex flex-wrap items-center justify-end gap-2 border-t border-hairline px-5 py-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-6 sm:pb-4">
              {footer}
            </div>
          ) : (
            <div className="h-[max(1rem,env(safe-area-inset-bottom))] sm:h-4" />
          )}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export const SheetTrigger = Dialog.Trigger;
export const SheetClose = Dialog.Close;
