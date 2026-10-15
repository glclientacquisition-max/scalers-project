"use client";

import { Dialog } from "@base-ui/react/dialog";
import { XMarkIcon } from "@heroicons/react/24/outline";
import type { ReactNode } from "react";
import { Sheet } from "@/components/ui/Sheet";
import { useIsPhone } from "@/components/ui/useIsPhone";

/**
 * Full text for a card or error line. Sheet on phone, side panel on desktop.
 * Read-only: links only, never a spend or state change.
 */
export function DetailPanel({
  open,
  onOpenChange,
  title,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children: ReactNode;
}) {
  const phone = useIsPhone();
  if (phone) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange} title={title} theme="admin">
        {children}
      </Sheet>
    );
  }
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className="desk-drawer-backdrop fixed inset-0 z-sheet" />
        <Dialog.Popup className="admin-theme fixed inset-y-0 end-0 z-sheet flex w-full max-w-md flex-col border-s border-hairline bg-surface text-ink shadow-sheet outline-none">
          <div className="flex items-start gap-3 px-6 pt-5">
            <Dialog.Title className="min-w-0 flex-1 text-title text-ink">{title}</Dialog.Title>
            <Dialog.Close
              aria-label="Close"
              className="-me-2 -mt-1 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-ink-2 hover:bg-surface-2 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
            >
              <XMarkIcon className="h-6 w-6" aria-hidden="true" />
            </Dialog.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">{children}</div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
