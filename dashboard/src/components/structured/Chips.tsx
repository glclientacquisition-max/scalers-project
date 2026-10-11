"use client";

import { settingsChipClass } from "@/components/settingsUi";

/** Chip group: multi (toggle buttons, aria-pressed) or single (radio semantics). Chips, not free text. */
export function Chips<T extends string>({
  label,
  options,
  value,
  onChange,
  multiple = false,
}: {
  label: string;
  options: ReadonlyArray<{ id: T; label: string }>;
  value: T[];
  onChange: (next: T[]) => void;
  multiple?: boolean;
}) {
  return (
    <div role={multiple ? "group" : "radiogroup"} aria-label={label} className="flex flex-wrap gap-2">
      {options.map((o) => {
        const on = value.includes(o.id);
        return (
          <button
            key={o.id}
            type="button"
            role={multiple ? undefined : "radio"}
            aria-pressed={multiple ? on : undefined}
            aria-checked={multiple ? undefined : on}
            className={settingsChipClass(on)}
            onClick={() => {
              if (multiple) onChange(on ? value.filter((v) => v !== o.id) : [...value, o.id]);
              else onChange(on ? [] : [o.id]);
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
