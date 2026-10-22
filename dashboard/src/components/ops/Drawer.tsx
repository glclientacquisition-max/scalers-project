"use client";

import { Drawer as BaseDrawer } from "@base-ui/react/drawer";
import { XMarkIcon } from "@heroicons/react/24/outline";
import type { ReactNode } from "react";
import { Sheet } from "@/components/ui/Sheet";
import { useIsPhone } from "@/components/ui/useIsPhone";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  dismissible?: boolean;
};

/** Bottom sheet below md (the shared Sheet), right side drawer from md. Never a centred modal. */
export function Drawer(props: Props) {
  const phone = useIsPhone();
  if (phone) return <Sheet {...props} theme="admin" />;
  const { open, onOpenChange, title, children, footer, dismissible = true } = props;
  return (
    <BaseDrawer.Root
      open={open}
      swipeDirection="right"
      disablePointerDismissal={!dismissible}
      onOpenChange={(next, details) => {
        if (!next && !dismissible) return details.cancel();
        onOpenChange(next);
      }}
    >
      <BaseDrawer.Portal>
        <BaseDrawer.Backdrop className="desk-drawer-backdrop fixed inset-0 z-sheet" />
        <BaseDrawer.Viewport className="desk-drawer-viewport pointer-events-none fixed inset-0 z-sheet flex justify-end">
          <BaseDrawer.Popup className="ops-drawer-side admin-theme ops-theme pointer-events-auto flex h-full w-full max-w-[560px] flex-col bg-surface text-ink shadow-sheet outline-none">
            <div className="flex h-12 items-center gap-2 border-b border-hairline px-ops-4">
              <BaseDrawer.Title className="min-w-0 flex-1 truncate text-ops-heading">{title}</BaseDrawer.Title>
              <BaseDrawer.Close aria-label="Close" className="-me-2 inline-flex h-9 w-9 items-center justify-center rounded-sm text-ink-2 hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand">
                <XMarkIcon className="h-5 w-5" aria-hidden="true" />
              </BaseDrawer.Close>
            </div>
            <BaseDrawer.Content className="min-h-0 flex-1 overflow-y-auto p-ops-4">{children}</BaseDrawer.Content>
            {footer ? <div className="flex items-center justify-end gap-2 border-t border-hairline px-ops-4 py-ops-3">{footer}</div> : null}
          </BaseDrawer.Popup>
        </BaseDrawer.Viewport>
      </BaseDrawer.Portal>
    </BaseDrawer.Root>
  );
}
