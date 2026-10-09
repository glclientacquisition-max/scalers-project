"use client";

import type { ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { Sheet } from "@/components/ui/Sheet";

/**
 * Short confirm. Same bottom drawer as every other overlay. Settings forms
 * stay pages. This is for one decision, then the drawer leaves.
 */
export function ConfirmSheet({
  open,
  title,
  children,
  confirmLabel,
  cancelLabel = "Cancel",
  pending = false,
  confirmDisabled = false,
  danger = false,
  theme = "desk",
  onClose,
  onConfirm,
}: {
  open: boolean;
  title: string;
  children: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  pending?: boolean;
  /** Keep the confirm off until the drawer's own check passes (a reason, a typed name). */
  confirmDisabled?: boolean;
  danger?: boolean;
  theme?: "desk" | "admin";
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <Sheet
      open={open}
      title={title}
      theme={theme}
      dismissible={!pending}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      footer={
        <>
          <Button variant="ghost" size="md" onClick={onClose} disabled={pending}>
            {cancelLabel}
          </Button>
          <Button variant={danger ? "danger" : "primary"} size="md" pending={pending} disabled={confirmDisabled} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="text-body text-ink-2">{children}</div>
    </Sheet>
  );
}
