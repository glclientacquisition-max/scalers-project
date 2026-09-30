import type { ReactNode } from "react";
import { deskPreviewClass } from "@/components/ui/deskChrome";

/**
 * People and businesses. Identity plus one truncated line.
 * Padding and dividers match the Inbox phone row.
 */
export function AdminIdentityList({ children, label }: { children: ReactNode; label: string }) {
  return (
    <ul aria-label={label} className="bg-surface">
      {children}
    </ul>
  );
}

export function AdminIdentityRow({
  title,
  line,
  aside,
  actions,
}: {
  title: string;
  line: string;
  /** Amount or status that must stay visible when the preview truncates. */
  aside?: string;
  actions?: ReactNode;
}) {
  return (
    <li className="border-t border-line/70 px-4 py-3 first:border-t-0">
      <p className={`text-body font-medium text-ink ${deskPreviewClass}`}>{title}</p>
      <div className="mt-0.5 flex min-w-0 items-baseline gap-3">
        <p className={`min-w-0 flex-1 text-meta text-ink-2 ${deskPreviewClass}`}>{line}</p>
        {aside ? <p className="shrink-0 text-meta tabular-nums text-ink">{aside}</p> : null}
      </div>
      {actions ? <div className="mt-2 flex flex-wrap gap-2">{actions}</div> : null}
    </li>
  );
}

export const adminRowActionClass =
  "inline-flex min-h-11 items-center rounded-xl px-3 text-sm font-medium text-accent hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-50";

export const adminRowMutedClass =
  "inline-flex min-h-11 items-center rounded-xl px-3 text-sm font-medium text-ink-2 hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-50";

export const adminRowDangerClass =
  "inline-flex min-h-11 items-center rounded-xl px-3 text-sm font-medium text-attention hover:bg-attention-tonal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-50";

export const adminThClass = "px-4 py-3 text-left text-meta font-medium text-ink-2";

export const adminTdClass = "px-4 py-3 align-middle";
