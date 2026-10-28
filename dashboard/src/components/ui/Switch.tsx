"use client";

import { cx } from "@/lib/cx";
import { deskShiftClass } from "@/components/ui/deskChrome";

/** Boolean control. 44px hit. On-state is accent. */
export function Switch({
  checked,
  onCheckedChange,
  label,
  disabled = false,
  id,
  describedBy,
}: {
  checked: boolean;
  onCheckedChange: (next: boolean) => void;
  label: string;
  disabled?: boolean;
  id?: string;
  /** id of the line that explains the switch (read after the name). */
  describedBy?: string;
}) {
  return (
    <label
      className={cx(
        "relative inline-flex min-h-11 min-w-11 cursor-pointer items-center justify-center rounded-full focus-within:outline-none focus-within:ring-2 focus-within:ring-brand",
        disabled && "cursor-not-allowed opacity-60",
      )}
    >
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        disabled={disabled}
        aria-label={label}
        id={id}
        aria-describedby={describedBy}
        onChange={(event) => {
          if (disabled) return;
          onCheckedChange(event.target.checked);
        }}
        className="absolute inset-0 z-10 m-0 cursor-pointer opacity-0 disabled:cursor-not-allowed"
      />
      <span
        aria-hidden
        className={cx(
          "relative inline-flex h-7 w-12 shrink-0 items-center rounded-full",
          deskShiftClass,
          checked ? "bg-accent" : "bg-hairline",
        )}
      >
        <span
          className={cx(
            "inline-block h-5 w-5 rounded-full bg-surface shadow",
            deskShiftClass,
            checked ? "translate-x-6" : "translate-x-1",
          )}
        />
      </span>
    </label>
  );
}
