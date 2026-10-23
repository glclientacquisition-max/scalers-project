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
  open, onClose, onConfirm, title, strength, confirmLabel, children, amount, typeToConfirm, pending = false, requireReason = false, reasonHint,
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
  /** Show a Reason field (3+ chars) on any strength — never require what you don't show. */
  requireReason?: boolean;
  reasonHint?: string;
}) {
  const [reason, setReason] = useState("");
  const [typed, setTyped] = useState("");
  const [touched, setTouched] = useState(false);
  const needReason = strength === "money" || requireReason;
  const reasonShort = needReason && reason.trim().length < 3;
  const blocked =
    reasonShort ||
    (strength === "destructive" && !!typeToConfirm && typed.trim() !== typeToConfirm);
  const typedShort = strength === "destructive" && !!typeToConfirm && typed.trim() !== typeToConfirm;
  /** Laws of UX — disabled states always say why, right next to the button. */
  const blockedWhy = reasonShort ? "Add a reason to continue." : typedShort ? `Type ${typeToConfirm} to continue.` : null;
  const close = () => { setReason(""); setTyped(""); setTouched(false); onClose(); };
  return (
    <Drawer
      open={open}
      title={title}
      dismissible={!pending}
      onOpenChange={(next) => { if (!next) close(); }}
      footer={
        <div className="flex w-full flex-col gap-ops-2" data-confirm-footer="">
          {blockedWhy && !pending ? (
            <p id="ops-confirm-blocked-why" className="text-right text-ops-label text-ink-2" data-blocked-why="">{blockedWhy}</p>
          ) : null}
          <div className="flex items-center justify-end gap-2">
            <Button variant="ghost" size="md" onClick={close} disabled={pending}>Cancel</Button>
            <Button
              variant={strength === "destructive" ? "dangerSolid" : "primary"}
              size="md"
              pending={pending}
              disabled={blocked}
              aria-describedby={blockedWhy ? "ops-confirm-blocked-why" : undefined}
              onClick={() => onConfirm(reason.trim())}
            >
              {confirmLabel}
            </Button>
          </div>
        </div>
      }
    >
      <div className="ops-theme flex flex-col gap-ops-3 text-ops-body text-ink-2">
        <div className={strength === "destructive" ? "border-l-2 border-attention ps-ops-3 text-ink" : "text-ink"} data-consequence="">{children}</div>
        {strength === "money" && amount !== undefined ? (
          <div className="flex items-center justify-between rounded-sm bg-surface-2 px-ops-3 py-ops-2">
            <span className="text-ops-label">Amount</span>
            <Money value={amount} className="text-ops-heading text-ink" />
          </div>
        ) : null}
        {needReason ? (
          <label className="flex flex-col gap-1 border-t border-hairline pt-ops-3">
            <span className="text-ops-label font-semibold text-ink">Reason</span>
            <textarea
              value={reason}
              rows={2}
              autoFocus
              placeholder="e.g. Test tenant, closing"
              onChange={(e) => setReason(e.target.value)}
              onBlur={() => setTouched(true)}
              aria-invalid={touched && reasonShort}
              aria-describedby="ops-confirm-reason-hint"
              data-field="reason"
              className="ops-field text-ink"
            />
            <span id="ops-confirm-reason-hint" className={touched && reasonShort ? "text-ops-label text-attention" : "text-ops-label text-ink-2"}>
              {touched && reasonShort ? "Add a reason (3 characters or more)." : (reasonHint ?? "3 characters or more. Shows in Activity.")}
            </span>
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
