"use client";

import { cx } from "@/lib/cx";
import { deskShiftClass } from "@/components/ui/deskChrome";

/** Boolean control. 44px hit. On-state is accent. */
export function Switch({
  checked,
  onCheckedChange,
  label,
  disabled = false,
}: {
  checked: boolean;
  onCheckedChange: (next: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <label
      className={cx(
        "inline-flex min-h-11 min-w-11 cursor-pointer items-center justify-center rounded-full focus-within:outline-none focus-within:ring-2 focus-within:ring-brand",
        disabled && "cursor-not-allowed opacity-60",
      )}
    >
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        disabled={disabled}
        aria-label={label}
        onChange={(event) => {
          if (disabled) return;
          onCheckedChange(event.target.checked);
        }}
        className="sr-only"
      />
      <span
        aria-hidden
        className={cx(
          "relative inline-flex h-7 w-12 shrink-0 items-center rounded-full",
          deskShiftClass,
          checked && !disabled ? "bg-accent" : "bg-hairline",
        )}
      >
        <span
          className={cx(
            "inline-block h-5 w-5 rounded-full bg-surface shadow",
            deskShiftClass,
            checked && !disabled ? "translate-x-6" : "translate-x-1",
          )}
        />
      </span>
    </label>
  );
}
