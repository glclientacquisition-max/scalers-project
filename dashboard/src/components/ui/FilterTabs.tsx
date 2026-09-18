import Link from "next/link";
import { filterTabClass, filterTabCountClass } from "@/components/ui/deskChrome";

export type FilterTabItem = {
  id: string;
  label: string;
  href: string;
  count?: number;
  divide?: boolean;
};

export function FilterTabs({
  label,
  items,
  active,
  wrap,
}: {
  label: string;
  items: readonly FilterTabItem[];
  active: string;
  wrap?: boolean;
}) {
  return (
    <nav aria-label={label} className="min-w-0 border-b border-line">
      <ul
        className={
          wrap
            ? "flex min-w-0 flex-wrap gap-1"
            : "-mx-1 flex gap-1 overflow-x-auto px-1 [scrollbar-width:thin]"
        }
      >
        {items.map((item) => {
          const isActive = active === item.id;
          return (
            <li
              key={item.id}
              className={
                item.divide
                  ? "ml-2 shrink-0 border-l border-line pl-3"
                  : "shrink-0"
              }
            >
              <Link
                href={item.href}
                aria-current={isActive ? "page" : undefined}
                className={filterTabClass(isActive)}
              >
                {item.label}
                {typeof item.count === "number" ? (
                  <span className={filterTabCountClass(isActive)}>{item.count}</span>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
