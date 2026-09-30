import type { ReactNode } from "react";
import { cx } from "@/lib/cx";

/**
 * Nothing here yet. One line that says what will appear, one action that makes it appear.
 * Sits inside the list region so the page keeps its shape.
 */
export function Empty({
  icon,
  title,
  line,
  action,
  className,
}: {
  icon?: ReactNode;
  title: string;
  /** What fills this and when. One sentence. */
  line?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx("flex flex-col items-center px-6 py-12 text-center", className)}>
      {icon ? (
        <span
          aria-hidden="true"
          className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-full bg-surface-2 text-ink-2 [&>svg]:h-6 [&>svg]:w-6"
        >
          {icon}
        </span>
      ) : null}
      <p className="text-title text-ink">{title}</p>
      {line ? <p className="mt-1 max-w-sm text-body text-ink-2">{line}</p> : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}
