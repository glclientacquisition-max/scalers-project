/**
 * Shared Business Settings UI tokens and primitives.
 * Keep density, focus rings, selection, and destructive actions consistent.
 */

import type { ReactNode } from "react";
import Link from "next/link";

export const settingsFieldClass =
  "mt-1 w-full min-h-11 rounded-xl border border-line bg-white px-3 py-2.5 text-sm outline-none transition duration-150 hover:border-[#0096FF]/35 focus:border-[#0096FF] focus:ring-2 focus:ring-[#0096FF]";

export const settingsDenseFieldClass =
  "w-full min-h-11 min-w-0 rounded-lg border border-line bg-white px-2.5 py-2 text-sm outline-none transition duration-150 hover:border-[#0096FF]/35 focus:border-[#0096FF] focus:ring-2 focus:ring-[#0096FF]";

export const settingsTableFieldClass =
  "w-full min-w-0 rounded-lg border border-line bg-white px-2 py-1.5 text-sm outline-none transition duration-150 hover:border-[#0096FF]/35 focus:border-[#0096FF] focus:ring-2 focus:ring-[#0096FF]";

/** Sole-panel sections stay flush (no top rule); use when stacking blocks inside one panel. */
export const settingsSectionClass = "space-y-3";

/** Sticks below the desk shell nav so Save stays visible while scrolling. */
export const settingsStickyHeaderClass =
  "sticky top-[var(--desk-header-h,4.5rem)] z-30 -mx-4 mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-line bg-surface-canvas/95 px-4 py-3 backdrop-blur-sm sm:-mx-6 sm:px-6";

export const settingsActionClass =
  "inline-flex min-h-11 items-center justify-center rounded-lg border border-line px-3 text-sm font-medium text-ink transition duration-150 hover:border-[#0096FF]/40 hover:bg-[#0096FF]/[0.04] active:scale-[0.99] active:bg-[#0096FF]/[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0096FF]";

export const settingsPrimaryButtonClass =
  "inline-flex min-h-11 items-center justify-center rounded-xl bg-[#0096FF] px-4 py-2.5 text-sm font-medium text-white shadow-[inset_0_-1px_0_rgba(0,0,0,0.08)] transition duration-150 hover:bg-[#0088e8] active:scale-[0.99] active:bg-[#007acc] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0096FF]/40 focus-visible:ring-offset-2 disabled:opacity-60";

export const settingsPanelHeadingClass =
  "font-display text-xl tracking-tight text-ink";

export const settingsBlockTitleClass =
  "text-[11px] font-bold uppercase tracking-wide text-gray-500";

export function settingsRadioCardClass(selected: boolean) {
  return [
    "w-full text-left rounded-xl border px-4 py-3 transition duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0096FF]/40",
    selected
      ? "border-transparent bg-[#0096FF]/10 ring-2 ring-[#0096FF] active:bg-[#0096FF]/15"
      : "border-line bg-white hover:border-[#0096FF]/40 hover:bg-[#0096FF]/[0.04] active:bg-[#0096FF]/[0.08]",
  ].join(" ");
}

export function settingsChipClass(selected: boolean) {
  return [
    "inline-flex min-h-11 items-center rounded-lg border px-3 py-2 text-left text-sm font-medium transition duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0096FF]/40",
    selected
      ? "border-transparent bg-[#0096FF]/10 text-[#005ccc] ring-1 ring-[#0096FF] active:bg-[#0096FF]/15"
      : "border-line bg-white text-ink hover:border-[#0096FF]/40 hover:bg-[#0096FF]/[0.04] active:bg-[#0096FF]/[0.08]",
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
        "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-ink-soft transition duration-150 hover:bg-surface hover:text-warn active:bg-surface-muted active:text-warn focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0096FF]/40",
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
        "relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition duration-150 hover:brightness-95 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0096FF] focus-visible:ring-offset-2",
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

export const settingsGhostButtonClass =
  "inline-flex min-h-11 items-center justify-center rounded-lg border border-transparent px-3 text-sm font-medium text-ink-soft transition duration-150 hover:bg-surface hover:text-ink active:bg-line focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0096FF]/40";

export function SettingsBackLink() {
  return (
    <Link
      href="/settings"
      className="mb-1 inline-flex min-h-11 items-center gap-1 text-sm font-medium text-[#0096FF] transition duration-150 hover:text-[#005ccc] active:text-[#004a99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0096FF]/40 lg:hidden"
    >
      <svg
        viewBox="0 0 20 20"
        fill="none"
        className="h-4 w-4 shrink-0"
        aria-hidden
      >
        <path
          d="M12.5 4.5 7 10l5.5 5.5"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      Business
    </Link>
  );
}

export function SettingsPageHeader({
  businessName,
  lineLive,
  lineDetail,
  action,
  showBack = false,
}: {
  businessName: string;
  lineLive: boolean;
  lineDetail?: string;
  action?: ReactNode;
  showBack?: boolean;
}) {
  return (
    <header className={settingsStickyHeaderClass}>
      <div className="min-w-0">
        {showBack ? <SettingsBackLink /> : null}
        <p className="font-sans text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-soft">
          Business
        </p>
        <h1 className="mt-1 font-display text-[clamp(1.5rem,2.4vw,2rem)] font-semibold leading-tight tracking-tight text-ink [overflow-wrap:anywhere]">
          {businessName}
        </h1>
        <p className="mt-1 text-[13px] text-ink-soft [overflow-wrap:anywhere]">
          <span className="font-medium text-ink">
            {lineLive ? "Line live" : "Number pending"}
          </span>
          {lineLive && lineDetail ? (
            <span className="mt-0.5 block truncate font-mono text-xs font-normal">
              {lineDetail}
            </span>
          ) : null}
        </p>
      </div>
      {action}
    </header>
  );
}

/** Default rows={2}; expands on focus for long paste without vertical sprawl. */
export const compactTextareaExpandHandlers = {
  onFocus: (e: React.FocusEvent<HTMLTextAreaElement>) => {
    e.currentTarget.rows = 4;
  },
  onBlur: (e: React.FocusEvent<HTMLTextAreaElement>) => {
    e.currentTarget.rows = 2;
  },
};

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
