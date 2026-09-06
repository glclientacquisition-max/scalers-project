/**
 * Shared desk class strings. Canon: docs/frontend/design-system/MASTER.md
 * Focus ring matches the platform mandate exactly.
 */

export const focusRing =
  "focus:outline-none focus:ring-2 focus:ring-[#0096FF] focus:ring-offset-2";

export const focusRingVisible =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0096FF] focus-visible:ring-offset-2";

export const btnPrimary = [
  "inline-flex min-h-11 items-center justify-center rounded-xl bg-[#0096FF] px-4 text-sm font-semibold text-white",
  "shadow-[inset_0_-1px_0_rgba(0,0,0,0.08)] transition hover:bg-[#0088e8]",
  focusRingVisible,
].join(" ");

export const btnGhost = [
  "inline-flex min-h-11 items-center justify-center rounded-xl border border-line px-4 text-sm font-medium text-ink",
  "transition hover:border-[#0096FF]",
  focusRingVisible,
].join(" ");

export const pageTitleClass =
  "font-display text-3xl tracking-tight text-ink sm:text-4xl";

export const metaLabelClass =
  "text-xs font-medium uppercase tracking-wide text-ink-soft";

export const tableHeadCellClass = "px-4 py-3 font-medium";

export const tableCellClass = "px-4 py-3.5";

export function filterTabClass(active: boolean) {
  return [
    "inline-flex min-h-11 items-center border-b-2 px-3 text-sm font-medium transition",
    focusRingVisible,
    active
      ? "border-[#0096FF] text-[#005CCC]"
      : "border-transparent text-ink-soft hover:border-line hover:text-ink",
  ].join(" ");
}
