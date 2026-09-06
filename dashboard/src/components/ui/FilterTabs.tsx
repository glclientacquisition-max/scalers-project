import Link from "next/link";
import { filterTabClass } from "@/components/ui/deskChrome";

export type FilterTabItem = {
  id: string;
  label: string;
  href: string;
  count?: number;
};

export function FilterTabs({
  label,
  items,
  active,
}: {
  label: string;
  items: readonly FilterTabItem[];
  active: string;
}) {
  return (
    <nav aria-label={label} className="border-b border-line">
      <ul className="flex gap-1 overflow-x-auto">
        {items.map((item) => {
          const isActive = active === item.id;
          return (
            <li key={item.id}>
                <Link
                  href={item.href}
                  aria-current={isActive ? "page" : undefined}
                  className={filterTabClass(isActive)}
                >
                  {item.label}
                  {item.count != null ? (
                    <span
                      className={[
                        "ml-2 tabular-nums text-xs",
                        isActive ? "text-[#005CCC]" : "text-ink-soft",
                      ].join(" ")}
                    >
                      {item.count}
                    </span>
                  ) : null}
                </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
