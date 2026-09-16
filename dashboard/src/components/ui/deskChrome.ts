/**
 * Shared desk class strings. Canon: docs/frontend/design-system/MASTER.md
 * Focus ring matches the platform mandate exactly.
 */

export const focusRing =
  "focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-2";

export const focusRingVisible =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2";

/** Fill only. Compose with size classes so Tailwind does not fight min-h-11 vs min-h-14. */
export const btnPrimaryFill =
  "bg-accent-fill font-semibold text-accent-on-fill shadow-[inset_0_-1px_0_rgba(0,0,0,0.08)] hover:bg-accent-fill-hover active:bg-accent-fill-active disabled:opacity-60";

/** Filled primary: on-fill on `--accent-fill` (~6:1 light, inverted on dark). `--accent` fails AA at `text-sm`. */
export const btnPrimary = [
  "inline-flex min-h-11 items-center justify-center rounded-xl px-4 text-sm",
  btnPrimaryFill,
  "transition-[background-color,transform,opacity] duration-150 active:scale-[0.99] motion-reduce:active:scale-100",
  focusRingVisible,
].join(" ");

export const btnGhost = [
  "inline-flex min-h-11 items-center justify-center rounded-xl border border-line px-4 text-sm font-medium text-ink",
  "transition-[border-color,background-color,color] duration-150 hover:border-accent",
  focusRingVisible,
].join(" ");

export const pendingSpinnerClass =
  "inline-block h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-accent-on-fill/40 border-t-accent-on-fill motion-reduce:animate-none";

export const deskFieldClass =
  "w-full min-h-11 rounded-xl border border-line bg-surface px-3 py-2.5 text-sm text-ink outline-none transition-[border-color,box-shadow] duration-150 placeholder:text-ink-soft/70 hover:border-accent/35 focus:border-accent focus:ring-2 focus:ring-accent";

export const deskErrorClass =
  "rounded-2xl border border-warn/40 bg-warn-soft p-6 text-warn";

export const deskEmptyClass = "mt-8 border-y border-line py-12 text-center";

export const pageTitleClass =
  "font-display text-[clamp(1.5rem,2.4vw,2rem)] font-semibold leading-tight tracking-tight text-ink";

export const metaLabelClass =
  "text-xs font-medium uppercase tracking-wide text-ink-soft";

export const tableHeadCellClass = "px-4 py-3 font-medium";

export const tableCellClass = "px-4 py-3.5";

export function filterTabClass(active: boolean) {
  return [
    "group inline-flex min-h-11 items-center gap-2 whitespace-nowrap border-b-2 px-3 text-sm font-medium",
    "transition-[color,border-color] duration-150",
    focusRingVisible,
    active
      ? "border-accent text-accent-deep"
      : "border-transparent text-ink-soft hover:border-line hover:text-ink",
  ].join(" ");
}

export function filterTabCountClass(active: boolean) {
  return [
    "rounded-md px-1.5 py-0.5 text-xs tabular-nums",
    active
      ? "bg-accent/10 text-accent-deep"
      : "bg-surface-muted text-ink-soft group-hover:bg-accent/10 group-hover:text-ink",
  ].join(" ");
}
