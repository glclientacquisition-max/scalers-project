"use client";

import { useState } from "react";
import { ConfirmSheet } from "@/components/ui/ConfirmSheet";
import { Field, Input } from "@/components/ui/Field";
import { Switch } from "@/components/ui/Switch";

/**
 * A switch that does not move until the save returns. The flip opens a confirm
 * with a reason. The checked prop stays the last saved value.
 */
export function ReasonedSwitch({
  checked,
  label,
  disabled = false,
  title,
  explain,
  confirmLabel,
  onSave,
}: {
  checked: boolean;
  label: string;
  disabled?: boolean;
  title: (next: boolean) => string;
  explain: (next: boolean) => string;
  confirmLabel: (next: boolean) => string;
  onSave: (next: boolean, reason: string) => Promise<string | null>;
}) {
  const [next, setNext] = useState<boolean | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const open = next !== null;

  function close() {
    if (pending) return;
    setNext(null);
    setReason("");
    setError(null);
  }

  async function confirm() {
    if (next === null || reason.trim().length < 3) return;
    setPending(true);
    setError(null);
    const problem = await onSave(next, reason.trim());
    setPending(false);
    if (problem) {
      setError(problem);
      return;
    }
    setNext(null);
    setReason("");
  }

  return (
    <>
      <Switch
        checked={checked}
        disabled={disabled}
        label={label}
        onCheckedChange={(value) => {
          if (disabled || pending) return;
          setError(null);
          setReason("");
          setNext(value);
        }}
      />
      <ConfirmSheet
        open={open}
        theme="admin"
        pending={pending}
        title={next === null ? label : title(next)}
        confirmLabel={next === null ? "Confirm" : confirmLabel(next)}
        confirmDisabled={reason.trim().length < 3}
        onClose={close}
        onConfirm={() => void confirm()}
      >
        <div className="space-y-4">
          <p>{next === null ? "" : explain(next)}</p>
          {error ? (
            <p className="text-body text-attention" role="alert">
              {error}
            </p>
          ) : null}
          <Field id={`${label.replace(/\s+/g, "-").toLowerCase()}-reason`} label="Reason" required>
            {(props) => (
              <Input {...props} value={reason} onChange={(event) => setReason(event.target.value)} />
            )}
          </Field>
        </div>
      </ConfirmSheet>
    </>
  );
}
