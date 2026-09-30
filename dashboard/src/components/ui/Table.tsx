import type { HTMLAttributes, TdHTMLAttributes, ThHTMLAttributes } from "react";
import { cx } from "@/lib/cx";

/**
 * Numeric admin data only (ledger, DID pool, packages). Lists of people and calls use `ListRow`.
 * Sticky head, hairline rows, tabular numerals, numbers right-aligned with `num`.
 */
export function Table({ className, children, ...rest }: HTMLAttributes<HTMLTableElement>) {
  return (
    <div
      tabIndex={0}
      className="-mx-4 overflow-x-auto outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand sm:-mx-6 md:mx-0 md:rounded-2xl md:border md:border-hairline"
    >
      <table className={cx("w-full min-w-[40rem] border-collapse bg-surface text-body text-ink", className)} {...rest}>
        {children}
      </table>
    </div>
  );
}

export function Thead({ className, ...rest }: HTMLAttributes<HTMLTableSectionElement>) {
  return <thead className={cx("sticky top-0 z-sticky bg-surface", className)} {...rest} />;
}

export function Th({ className, num = false, ...rest }: ThHTMLAttributes<HTMLTableCellElement> & { num?: boolean }) {
  return (
    <th
      scope="col"
      className={cx(
        "border-b border-hairline px-4 py-2.5 text-caption font-medium uppercase tracking-wide text-ink-2",
        num ? "text-end" : "text-start",
        className,
      )}
      {...rest}
    />
  );
}

export function Td({ className, num = false, ...rest }: TdHTMLAttributes<HTMLTableCellElement> & { num?: boolean }) {
  return (
    <td
      className={cx("border-b border-hairline px-4 py-3 align-middle", num && "text-end tabular-nums", className)}
      {...rest}
    />
  );
}

export const Tbody = "tbody";
