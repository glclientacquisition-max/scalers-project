import Link from "next/link";
import type { ReactNode } from "react";
import { cx } from "@/lib/cx";

/**
 * The list recipe. Identity, one truncated preview line, when, one glance state, compact actions.
 * The row body is one link (or button); actions sit beside it so a tap on Call never opens the record.
 * Wrap rows in `<ul className="divide-y divide-hairline">`.
 */
export function ListRow({
  href,
  onOpen,
  aside,
  leading,
  title,
  preview,
  when,
  stamp,
  actions,
  unread = false,
  selected = false,
  className,
  ariaLabel,
  as = "li",
}: {
  href?: string;
  onOpen?: () => void;
  /** Checkbox or other hit that must not sit inside the row link. */
  aside?: ReactNode;
  /** Avatar or icon. Inside the row link. */
  leading?: ReactNode;
  title: ReactNode;
  preview?: ReactNode;
  /** Short timestamp. Right of the title on every width. */
  when?: ReactNode;
  /** A `Stamp`. Right of the preview. */
  stamp?: ReactNode;
  /** `IconButton`s or a `Button`. Not inside the link. */
  actions?: ReactNode;
  unread?: boolean;
  selected?: boolean;
  className?: string;
  ariaLabel?: string;
  /** `div` when a parent already owns the list item (long-press shell). */
  as?: "li" | "div";
}) {
  const bodyClass =
    "flex min-w-0 flex-1 items-center gap-3 py-3 pe-2 text-start outline-none transition-colors duration-fast ease-out focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand " +
    (aside ? "ps-2" : "ps-4");
  const content = (
    <>
      {leading ? <span className="shrink-0">{leading}</span> : null}
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-3">
          <span className={cx("min-w-0 flex-1 truncate text-body text-ink", unread ? "font-semibold" : "font-medium")}>
            {title}
          </span>
          {when ? (
            <span className={cx("shrink-0 text-caption tabular-nums", unread ? "text-accent" : "text-ink-3")}>
              {when}
            </span>
          ) : null}
        </span>
        {preview || stamp ? (
          <span className="mt-0.5 flex items-center gap-3">
            {preview ? (
              <span className={cx("min-w-0 flex-1 truncate text-meta", unread ? "text-ink" : "text-ink-2")}>
                {preview}
              </span>
            ) : (
              <span className="flex-1" />
            )}
            {stamp ? <span className="shrink-0">{stamp}</span> : null}
          </span>
        ) : null}
      </span>
    </>
  );

  const Tag = as;
  return (
    <Tag
      className={cx(
        "flex min-w-0 items-stretch transition-colors duration-fast ease-out hover:bg-surface-2/60 has-[a:active]:bg-surface-2 has-[button:active]:bg-surface-2",
        selected ? "bg-accent-tonal" : "bg-surface",
        className,
      )}
    >
      {aside ? <div className="flex shrink-0 items-center gap-1 ps-3">{aside}</div> : null}
      {href ? (
        <Link href={href} aria-label={ariaLabel} className={bodyClass}>
          {content}
        </Link>
      ) : onOpen ? (
        <button type="button" onClick={onOpen} aria-label={ariaLabel} className={bodyClass}>
          {content}
        </button>
      ) : (
        <div className={bodyClass}>{content}</div>
      )}
      {actions ? <div className="flex shrink-0 items-center gap-1 pe-3">{actions}</div> : null}
    </Tag>
  );
}
