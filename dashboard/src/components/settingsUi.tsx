"use client";

/**
 * Shared Business Settings UI tokens and primitives.
 * Keep density, focus rings, selection, and destructive actions consistent.
 * Primary fill and field chrome come from deskChrome.ts (one dialect).
 */

import type { ReactNode } from "react";
import { DeskBack, DeskRecordLead } from "@/components/ui/DeskBack";
import { SignOutButton } from "@/components/ui/SignOutButton";
import {
  btnPrimary,
  deskFieldClass,
  deskShiftClass,
  filterTabClass,
} from "@/components/ui/deskChrome";

export const settingsFieldClass = `mt-1 ${deskFieldClass}`;

export const settingsDenseFieldClass =
  `w-full min-h-11 min-w-0 rounded-lg border border-line bg-surface px-2.5 py-2 text-sm text-ink outline-none ${deskShiftClass} placeholder:text-ink-soft/70 hover:border-accent/35 focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent`;

export const settingsTableFieldClass =
  `w-full min-w-0 rounded-lg border border-line bg-surface px-2 py-1.5 text-sm text-ink outline-none ${deskShiftClass} placeholder:text-ink-soft/70 hover:border-accent/35 focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent`;

/** Sole-panel sections stay flush (no top rule); use when stacking blocks inside one panel. */
export const settingsSectionClass = "space-y-3";

/** Nested settings: compact inner rail + fluid panel. Fills the desk canvas. */
export const settingsConsoleClass =
  "flex w-full min-w-0 flex-col gap-6 lg:flex-row lg:items-start lg:gap-8";

export const settingsRailWrapClass =
  "hidden min-w-0 shrink-0 lg:block lg:w-[13.5rem]";

export const settingsRailClass = "min-w-0 lg:sticky lg:top-4";

export const settingsPanelClass = "min-w-0 flex-1";

export const settingsFormGridClass =
  "grid grid-cols-1 gap-x-6 gap-y-4 md:grid-cols-2";

/** Sticks to the panel so Save stays docked top-right while scrolling. */
export const settingsStickyHeaderClass =
  "sticky top-[var(--desk-header-h,0px)] z-30 mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-line bg-surface-canvas/95 py-3 backdrop-blur-sm";

export const settingsActionClass =
  `inline-flex min-h-11 items-center justify-center rounded-lg border border-line px-3 text-sm font-medium text-ink ${deskShiftClass} hover:border-accent/40 hover:bg-accent/[0.04] active:scale-[0.99] active:bg-accent/[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent`;

export const settingsTrashButtonClass =
  `inline-flex h-11 w-11 min-h-11 min-w-11 shrink-0 items-center justify-center rounded-lg text-ink-soft ${deskShiftClass} hover:bg-surface hover:text-warn active:bg-surface-muted active:text-warn focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40`;

export const settingsPrimaryButtonClass = btnPrimary;

export const settingsPanelHeadingClass =
  "font-display text-xl font-semibold tracking-tight text-ink";

export const settingsBlockTitleClass =
  "text-[11px] font-bold uppercase tracking-wide text-gray-500";

/** Non-clickable group header. Same dialect as the Profile rail. */
export const settingsGroupTitleClass =
  "pointer-events-none mb-0 select-none text-xs font-bold uppercase tracking-wide text-gray-500";

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
        settingsTrashButtonClass,
        className,
      ].join(" ")}
    >
      <TrashIcon />
    </button>
  );
}

/** Native checkbox drawn as a switch. 44px hit. On-state accent-fill. Focus ring accent. */
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
    <label
      data-settings-toggle=""
      className={[
        "inline-flex min-h-11 min-w-11 cursor-pointer items-center justify-center rounded-full focus-within:outline-none focus-within:ring-2 focus-within:ring-accent",
        disabled ? "cursor-not-allowed opacity-60" : "",
      ].join(" ")}
    >
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        disabled={disabled}
        aria-label={label}
        onChange={(e) => {
          if (disabled) return;
          onChange(e.target.checked);
        }}
        className="sr-only"
      />
      <span
        aria-hidden
        className={[
          `relative inline-flex h-7 w-12 shrink-0 items-center rounded-full ${deskShiftClass}`,
          checked && !disabled ? "bg-accent-fill" : "bg-line",
        ].join(" ")}
      >
        <span
          className={[
            `inline-block h-5 w-5 rounded-full bg-surface shadow ${deskShiftClass}`,
            checked && !disabled ? "translate-x-6" : "translate-x-1",
          ].join(" ")}
        />
      </span>
    </label>
  );
}

export const SettingsToggle = ToolSwitch;

export function SettingsGroup({
  title,
  action,
  children,
}: {
  title?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="min-w-0 w-full space-y-1.5">
      {title || action ? (
        <div className="flex min-h-8 items-end justify-between gap-3 px-1">
          {title ? <h3 className={settingsGroupTitleClass}>{title}</h3> : <span />}
          {action}
        </div>
      ) : null}
      <div className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface">
        {children}
      </div>
    </section>
  );
}

export function SettingsRow({
  label,
  htmlFor,
  hint,
  control = "field",
  children,
}: {
  label: ReactNode;
  htmlFor?: string;
  hint?: string;
  control?: "field" | "switch";
  children: ReactNode;
}) {
  const switchRow = control === "switch";
  return (
    <div className="flex min-h-12 w-full items-center gap-3 px-4 py-2">
      <div className={switchRow ? "min-w-0 flex-1" : "w-[7.5rem] shrink-0 sm:w-36"}>
        <label htmlFor={htmlFor} className="block text-sm font-medium text-ink">
          {label}
        </label>
        {hint ? <p className="mt-0.5 text-xs text-ink-soft">{hint}</p> : null}
      </div>
      <div className={switchRow ? "shrink-0" : "min-w-0 flex-1"}>{children}</div>
    </div>
  );
}

export function SettingsStack({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5 px-4 py-3">
      <label htmlFor={htmlFor} className="block text-sm font-medium text-ink">
        {label}
      </label>
      {children}
    </div>
  );
}

export function SettingsSegmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly { id: T; label: string }[];
  onChange: (id: T) => void;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="w-full min-w-0 border-b border-line">
      <ul className="-mx-1 flex gap-1 overflow-x-auto px-1 [scrollbar-width:thin]">
        {options.map((opt) => {
          const selected = value === opt.id;
          return (
            <li key={opt.id} className="shrink-0">
              <button
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => onChange(opt.id)}
                className={filterTabClass(selected)}
              >
                {opt.label}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function SettingsSelect<T extends string>({
  id,
  value,
  onChange,
  options,
  label,
  placeholder,
}: {
  id: string;
  value: T | "";
  onChange: (value: T) => void;
  options: readonly { id: T; label: string }[];
  label?: string;
  placeholder?: string;
}) {
  return (
    <select
      id={id}
      value={value}
      aria-label={label}
      onChange={(e) => onChange(e.target.value as T)}
      className={`${settingsDenseFieldClass} min-w-0`}
    >
      {placeholder || value === "" ? (
        <option value="" disabled={value !== ""}>
          {placeholder || "Select"}
        </option>
      ) : null}
      {options.map((opt) => (
        <option key={opt.id} value={opt.id}>
          {opt.label}
        </option>
      ))}
    </select>
  );
}

export const settingsGhostButtonClass =
  `inline-flex min-h-11 items-center justify-center rounded-lg border border-transparent px-3 text-sm font-medium text-ink-soft ${deskShiftClass} hover:bg-surface hover:text-ink active:bg-line focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40`;

export function SettingsBackLink() {
  return (
    <DeskBack href="/settings" className="lg:hidden">
      Profile
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
  title,
}: {
  businessName: string;
  lineLive: boolean;
  lineDetail?: string;
  action?: ReactNode;
  showBack?: boolean;
  index?: boolean;
  title?: string | null;
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
      <header className="mb-4 flex min-w-0 flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-display text-xl font-semibold tracking-tight text-ink">Profile</h1>
          <p className="mt-1 min-w-0 truncate text-sm font-medium text-ink">{businessName}</p>
          {line}
        </div>
        <SignOutButton />
      </header>
    );
  }

  return (
    <header className={settingsStickyHeaderClass}>
      <div className="min-w-0 flex-1">
        {showBack ? (
          <DeskRecordLead align="center" back={<SettingsBackLink />}>
            {title ? <h1 className={settingsPanelHeadingClass}>{title}</h1> : null}
            {line}
          </DeskRecordLead>
        ) : (
          <>
            {title ? <h1 className={settingsPanelHeadingClass}>{title}</h1> : null}
            {line}
          </>
        )}
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
