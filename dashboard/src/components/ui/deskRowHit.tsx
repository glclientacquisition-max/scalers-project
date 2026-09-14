import Link from "next/link";

/**
 * Invisible hit over a `relative` row. Trailing buttons use `deskRowActionClass`.
 * Canon: docs/frontend/design-system/MASTER.md (list rows).
 */
export const deskRowHitClass =
  "absolute inset-0 z-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#0096FF]";

export const deskRowMutedClass = "relative z-[1] pointer-events-none";

export const deskRowActionClass = "relative z-10";

export function DeskRowHit({
  href,
  label,
}: {
  href: string | null | undefined;
  label: string;
}) {
  if (!href) return null;
  return <Link href={href} aria-label={label} className={deskRowHitClass} />;
}
