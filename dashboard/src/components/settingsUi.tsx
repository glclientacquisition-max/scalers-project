/**
 * Shared Business Settings UI tokens and primitives.
 * Keep density, focus rings, selection, and destructive actions consistent.
 * Primary fill and field chrome come from deskChrome.ts (one dialect).
 */

import type { ReactNode } from "react";
import { DeskBack } from "@/components/ui/DeskBack";
import { btnPrimary, deskFieldClass, deskShiftClass } from "@/components/ui/deskChrome";

export const settingsFieldClass = `mt-1 ${deskFieldClass}`;

export const settingsDenseFieldClass =
  `w-full min-h-11 min-w-0 rounded-lg border border-line bg-surface px-2.5 py-2 text-sm text-ink outline-none ${deskShiftClass} placeholder:text-ink-soft/70 hover:border-accent/35 focus:border-accent focus:ring-2 focus:ring-accent`;

export const settingsTableFieldClass =
  `w-full min-w-0 rounded-lg border border-line bg-surface px-2 py-1.5 text-sm text-ink outline-none ${deskShiftClass} placeholder:text-ink-soft/70 hover:border-accent/35 focus:border-accent focus:ring-2 focus:ring-accent`;

/** Sole-panel sections stay flush (no top rule); use when stacking blocks inside one panel. */
export const settingsSectionClass = "space-y-3";

/** Sticks below the desk shell nav so Save stays visible while scrolling. */
export const settingsStickyHeaderClass =
  "sticky top-[var(--desk-header-h,3.75rem)] z-30 -mx-4 mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-line bg-surface-canvas/95 px-4 py-3 backdrop-blur-sm sm:-mx-6 sm:px-6";

export const settingsActionClass =
  `inline-flex min-h-11 items-center justify-center rounded-lg border border-line px-3 text-sm font-medium text-ink ${deskShiftClass} hover:border-accent/40 hover:bg-accent/[0.04] active:scale-[0.99] active:bg-accent/[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent`;

export const settingsPrimaryButtonClass = btnPrimary;

export const settingsPanelHeadingClass =
  "font-display text-xl tracking-tight text-ink";

export const settingsBlockTitleClass =
  "text-[11px] font-bold uppercase tracking-wide text-ink-soft";

export function settingsRadioCardClass(selected: boolean) {
  return [
    `w-full text-left rounded-xl border px-4 py-3 ${deskShiftClass} focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40`,
    selected
      ? "border-transparent bg-accent/10 ring-2 ring-accent active:bg-accent/15"
      : "border-line bg-surface text-ink hover:border-accent/40 hover:bg-accent/[0.04] active:bg-accent/[0.08]",
  ].join(" ");
}

export function settingsChipClass(selected: boolean) {
  return [
    `inline-flex min-h-11 items-center rounded-lg border px-3 py-2 text-left text-sm font-medium ${deskShiftClass} focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40`,
    selected
      ? "border-transparent bg-accent/10 text-accent-deep ring-1 ring-accent active:bg-accent/15"
      : "border-line bg-surface text-ink hover:border-accent/40 hover:bg-accent/[0.04] active:bg-accent/[0.08]",
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
        `inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-ink-soft ${deskShiftClass} hover:bg-surface hover:text-warn active:bg-surface-muted active:text-warn focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40`,
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
        `relative inline-flex h-7 w-12 shrink-0 items-center rounded-full ${deskShiftClass} hover:brightness-95 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2`,
        disabled ? "cursor-not-allowed opacity-60" : "",
        checked && !disabled ? "bg-accent" : "bg-line",
      ].join(" ")}
    >
      <span
        className={[
          `inline-block h-5 w-5 rounded-full bg-surface shadow ${deskShiftClass}`,
          checked && !disabled ? "translate-x-6" : "translate-x-1",
        ].join(" ")}
      />
    </button>
  );
}

export const settingsGhostButtonClass =
  `inline-flex min-h-11 items-center justify-center rounded-lg border border-transparent px-3 text-sm font-medium text-ink-soft ${deskShiftClass} hover:bg-surface hover:text-ink active:bg-line focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40`;

export function SettingsBackLink() {
  return (
    <DeskBack href="/settings" className="mb-1 lg:hidden">
      Business Profile
    </DeskBack>
  );
}

export function SettingsPageHeader({
  businessName,
  lineLive,
  lineDetail,
  action,
  showBack = false,
  index = false,
}: {
  businessName: string;
  lineLive: boolean;
  lineDetail?: string;
  action?: ReactNode;
  showBack?: boolean;
  index?: boolean;
}) {
  const line = (
    <p className="text-[13px] text-ink-soft [overflow-wrap:anywhere]">
      <span className="font-medium text-ink">
        {lineLive ? "Line live" : "Number pending"}
      </span>
      {lineLive && lineDetail ? (
        <span className="mt-0.5 block truncate font-mono text-xs font-normal">
          {lineDetail}
        </span>
      ) : null}
    </p>
  );

  if (index) {
    return (
      <header className="mb-4 flex min-w-0 flex-wrap items-center justify-between gap-3">
        <p className="min-w-0 truncate text-sm font-medium text-ink">{businessName}</p>
        {line}
      </header>
    );
  }

  return (
    <header className={settingsStickyHeaderClass}>
      <div className="min-w-0">
        {showBack ? <SettingsBackLink /> : null}
        {line}
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
