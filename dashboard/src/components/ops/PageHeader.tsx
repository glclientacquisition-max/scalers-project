import type { ReactNode } from "react";
import { formatCount } from "@/lib/ops/format";

/** Title, optional count, actions. No subtitle sentence. */
export function PageHeader({ title, count, actions }: { title: string; count?: number; actions?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-center gap-x-3 gap-y-2 pb-ops-4">
      <h1 className="text-ops-title text-ink">
        {title}
        {count !== undefined ? <span className="ops-num ms-2 text-ops-heading font-normal text-ink-2">{formatCount(count)}</span> : null}
      </h1>
      {actions ? <div className="ms-auto flex items-center gap-2">{actions}</div> : null}
    </header>
  );
}
