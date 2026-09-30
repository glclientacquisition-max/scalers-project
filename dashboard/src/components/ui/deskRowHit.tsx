import Link from "next/link";

/**
 * Invisible hit over a `relative` row. Trailing buttons use `deskRowActionClass`.
 * Canon: docs/frontend/design-system/MASTER.md (list rows).
 */
export const deskRowHitClass =
  "absolute inset-0 z-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent";

export const deskRowMutedClass = "relative z-[1] pointer-events-none";

export const deskRowActionClass = "relative z-10";

export function DeskRowHit({
  href,
  label,
  rowBody = false,
}: {
  href: string | null | undefined;
  label: string;
  rowBody?: boolean;
}) {
  if (!href) return null;
  return (
    <Link
      href={href}
      aria-label={label}
      data-inbox-row-body={rowBody ? "" : undefined}
      className={deskRowHitClass}
    />
  );
}
