import type { ReactNode } from "react";

/**
 * The one Super Admin page header: title, an optional one-line subtitle, optional actions.
 * Every Admin destination opens with it, so pages read as one product.
 */
export function AdminPageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header
      data-admin-page-header=""
      className="flex flex-wrap items-end justify-between gap-3 px-4 pb-2"
    >
      <div className="min-w-0">
        <h1 className="text-page font-semibold text-ink">{title}</h1>
        {subtitle ? (
          <p className="mt-0.5 truncate text-meta text-ink-2">{subtitle}</p>
        ) : null}
      </div>
      {actions ? (
        <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>
      ) : null}
    </header>
  );
}
