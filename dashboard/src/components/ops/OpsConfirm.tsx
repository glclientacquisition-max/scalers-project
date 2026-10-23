"use client";

import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { Drawer } from "./Drawer";
import { Money } from "./Money";

export type ConfirmStrength = "light" | "money" | "destructive";

/**
 * ConfirmSheet pattern for Admin: bottom sheet on phones, side drawer from md.
 * light: one fact. money: amount + required reason. destructive: typed word unlocks Confirm.
 */
export function OpsConfirm({
  open, onClose, onConfirm, title, strength, confirmLabel, children, amount, typeToConfirm, pending = false,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => void;
  title: string;
  strength: ConfirmStrength;
  confirmLabel: string;
  children: ReactNode;
  amount?: number;
  typeToConfirm?: string;
  pending?: boolean;
}) {
  const [reason, setReason] = useState("");
  const [typed, setTyped] = useState("");
  const blocked =
    (strength === "money" && reason.trim().length < 3) ||
    (strength === "destructive" && !!typeToConfirm && typed.trim() !== typeToConfirm);
  const close = () => { setReason(""); setTyped(""); onClose(); };
  return (
    <Drawer
      open={open}
      title={title}
      dismissible={!pending}
      onOpenChange={(next) => { if (!next) close(); }}
      footer={
        <>
          <Button variant="ghost" size="md" onClick={close} disabled={pending}>Cancel</Button>
          <Button variant={strength === "destructive" ? "danger" : "primary"} size="md" pending={pending} disabled={blocked} onClick={() => onConfirm(reason.trim())}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="ops-theme flex flex-col gap-3 text-ops-body text-ink-2">
        <div>{children}</div>
        {strength === "money" && amount !== undefined ? (
          <div className="flex items-center justify-between rounded-sm bg-surface-2 px-ops-3 py-ops-2">
            <span className="text-ops-label">Amount</span>
            <Money value={amount} className="text-ops-heading text-ink" />
          </div>
        ) : null}
        {strength === "money" ? (
          <label className="flex flex-col gap-1">
            <span className="text-ops-label text-ink">Reason</span>
            <input value={reason} onChange={(e) => setReason(e.target.value)} className="ops-field text-ink" />
          </label>
        ) : null}
        {strength === "destructive" && typeToConfirm ? (
          <label className="flex flex-col gap-1">
            <span className="text-ops-label text-ink">Type {typeToConfirm} to confirm</span>
            <input value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" className="ops-field text-ink" />
          </label>
        ) : null}
      </div>
    </Drawer>
  );
}
