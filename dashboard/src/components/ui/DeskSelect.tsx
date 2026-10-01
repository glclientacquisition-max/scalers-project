"use client";

import { Select } from "@base-ui/react/select";
import { CheckIcon, ChevronDownIcon } from "@heroicons/react/20/solid";
import { cx } from "@/lib/cx";

/**
 * Closed chrome matches desk field classes; open list is a themed popover
 * (bg-surface + text-ink) so dark mode never falls back to a light OS popup.
 * Portal content is wrapped in `.desk-theme` (same as InboxRowOverflow) so
 * dark CSS vars resolve when Select.Portal mounts under body.
 * Color-scheme pin on remaining native selects stays; this covers DoD paths.
 */
const popupClass =
  "z-menu max-h-[min(20rem,var(--available-height))] min-w-[var(--anchor-width)] origin-[var(--transform-origin)] overflow-y-auto rounded-xl border border-hairline bg-surface py-1.5 text-body text-ink shadow-menu outline-none transition-[opacity,transform] duration-fast ease-out data-[ending-style]:scale-95 data-[ending-style]:opacity-0 data-[starting-style]:scale-95 data-[starting-style]:opacity-0 motion-reduce:transition-none";

const itemClass =
  "grid min-h-11 cursor-default select-none grid-cols-[1rem_1fr] items-center gap-2 px-3 outline-none data-[highlighted]:bg-surface-2 data-[disabled]:opacity-50";

export type DeskSelectOption<T extends string = string> = {
  value: T;
  label: string;
  disabled?: boolean;
};

export function DeskSelect<T extends string>({
  id,
  value,
  onChange,
  options,
  placeholder,
  "aria-label": ariaLabel,
  className,
  disabled,
  name,
  required,
}: {
  id?: string;
  value: T | "";
  onChange: (value: T) => void;
  options: readonly DeskSelectOption<T>[];
  placeholder?: string;
  "aria-label"?: string;
  className?: string;
  disabled?: boolean;
  name?: string;
  required?: boolean;
}) {
  const items = options.map((opt) => ({ value: opt.value, label: opt.label }));
  const selected: T | null = value === "" ? null : value;

  return (
    <Select.Root
      id={id}
      value={selected}
      onValueChange={(next) => {
        if (next == null) return;
        onChange(next as T);
      }}
      items={items}
      disabled={disabled}
      name={name}
      required={required}
      modal={false}
    >
      <Select.Trigger
        aria-label={ariaLabel}
        className={cx(
          "inline-flex items-center justify-between gap-2 text-start",
          className
        )}
      >
        <Select.Value
          className="min-w-0 flex-1 truncate data-[placeholder]:text-ink-soft/70"
          placeholder={placeholder || "Select"}
        />
        <Select.Icon className="pointer-events-none shrink-0 text-ink-2">
          <ChevronDownIcon aria-hidden="true" className="h-5 w-5" />
        </Select.Icon>
      </Select.Trigger>
      {/* Portal mounts under body; wrap so dark tokens (--surface/--ink) resolve under .desk-theme */}
      <Select.Portal>
        <div className="desk-theme">
          <Select.Positioner
            className="z-menu outline-none"
            sideOffset={6}
            collisionPadding={12}
            alignItemWithTrigger={false}
          >
            <Select.Popup className={popupClass}>
              <Select.List>
                {options.map((opt) => (
                  <Select.Item
                    key={opt.value}
                    value={opt.value}
                    disabled={opt.disabled}
                    className={itemClass}
                  >
                    <Select.ItemIndicator className="col-start-1 flex items-center justify-center text-ink">
                      <CheckIcon aria-hidden="true" className="h-4 w-4" />
                    </Select.ItemIndicator>
                    <Select.ItemText className="col-start-2 min-w-0 truncate">
                      {opt.label}
                    </Select.ItemText>
                  </Select.Item>
                ))}
              </Select.List>
            </Select.Popup>
          </Select.Positioner>
        </div>
      </Select.Portal>
    </Select.Root>
  );
}
