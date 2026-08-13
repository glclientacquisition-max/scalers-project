/**
 * Shared Business Settings UI tokens and primitives.
 * Keep density, focus rings, selection, and destructive actions consistent.
 */

export const settingsFieldClass =
  "mt-1 w-full rounded-xl border border-line bg-white px-3 py-2.5 text-sm outline-none transition focus:border-[#0096FF] focus:ring-2 focus:ring-[#0096FF]/40";

export const settingsDenseFieldClass =
  "w-full min-w-0 rounded-lg border border-line bg-white px-2.5 py-2 text-sm outline-none transition focus:border-[#0096FF] focus:ring-2 focus:ring-[#0096FF]/40";

export const settingsTableFieldClass =
  "w-full min-w-0 rounded-lg border border-line bg-white px-2 py-1.5 text-sm outline-none transition focus:border-[#0096FF] focus:ring-2 focus:ring-[#0096FF]/40";

/** Sole-panel sections stay flush (no top rule); use when stacking blocks inside one panel. */
export const settingsSectionClass = "space-y-3";

/** Sticks below the desk shell nav so Save stays visible while scrolling. */
export const settingsStickyHeaderClass =
  "sticky top-[var(--desk-header-h,4.5rem)] z-30 -mx-4 mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-line bg-surface-canvas/95 px-4 py-3 backdrop-blur-sm sm:-mx-6 sm:px-6";

export const settingsActionClass =
  "inline-flex min-h-11 items-center justify-center rounded-lg border border-line px-3 text-sm font-medium text-ink transition hover:border-[#0096FF]/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0096FF]/40";

export function settingsRadioCardClass(selected: boolean) {
  return [
    "w-full text-left rounded-xl border px-4 py-3 transition",
    selected
      ? "border-transparent bg-[#0096FF]/10 ring-2 ring-[#0096FF]"
      : "border-line bg-white hover:border-[#0096FF]/40",
  ].join(" ");
}

export function settingsChipClass(selected: boolean) {
  return [
    "inline-flex min-h-11 items-center rounded-lg border px-3 py-2 text-left text-sm font-medium transition",
    selected
      ? "border-transparent bg-[#0096FF]/10 text-[#005ccc] ring-1 ring-[#0096FF]"
      : "border-line bg-white text-ink hover:border-[#0096FF]/40",
  ].join(" ");
}

export function TrashIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M3 6h18" />
      <path d="M8 6V4h8v2" />
      <path d="M19 6l-1 14H6L5 6" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
    </svg>
  );
}

export function TrashButton({
  label,
  onClick,
  className = "",
}: {
  label: string;
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={[
        "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-ink-soft transition hover:bg-surface hover:text-warn",
        className,
      ].join(" ")}
    >
      <TrashIcon />
    </button>
  );
}

export function ToolSwitch({
  checked,
  onChange,
  label,
  disabled = false,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => {
        if (disabled) return;
        onChange(!checked);
      }}
      className={[
        "relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0096FF]/40 focus-visible:ring-offset-2",
        disabled ? "cursor-not-allowed opacity-60" : "",
        checked && !disabled ? "bg-[#0096FF]" : "bg-line",
      ].join(" ")}
    >
      <span
        className={[
          "inline-block h-5 w-5 rounded-full bg-white shadow transition",
          checked && !disabled ? "translate-x-6" : "translate-x-1",
        ].join(" ")}
      />
    </button>
  );
}

export function ExpandTextarea({
  id,
  value,
  onChange,
  placeholder,
  maxLength,
  className = "",
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  maxLength?: number;
  className?: string;
}) {
  return (
    <textarea
      id={id}
      value={value}
      maxLength={maxLength}
      onChange={(e) => onChange(e.target.value)}
      rows={2}
      onFocus={(e) => {
        e.currentTarget.rows = 4;
      }}
      onBlur={(e) => {
        e.currentTarget.rows = 2;
      }}
      placeholder={placeholder}
      className={[settingsFieldClass, "leading-relaxed", className]
        .filter(Boolean)
        .join(" ")}
    />
  );
}
