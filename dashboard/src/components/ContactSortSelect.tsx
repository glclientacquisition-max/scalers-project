"use client";

import { ChevronDownIcon } from "@heroicons/react/20/solid";
import { useRouter } from "next/navigation";
import { buttonClass } from "@/components/ui/Button";
import { Menu, MenuItem } from "@/components/ui/Menu";
import {
  contactsHref,
  type ContactSavedFilter,
  type ContactSort,
} from "@/lib/contactsLoad";

const SORT_OPTIONS: Array<{ value: ContactSort; label: string }> = [
  { value: "recent", label: "Last call" },
  { value: "name", label: "Name" },
];

export function ContactSortSelect({
  saved,
  sort,
  q,
  selectedId,
}: {
  saved: ContactSavedFilter;
  sort: ContactSort;
  q: string;
  selectedId?: string | null;
}) {
  const router = useRouter();
  const active = SORT_OPTIONS.find((row) => row.value === sort)?.label ?? "Last call";

  function pick(next: ContactSort) {
    router.replace(
      contactsHref({
        saved,
        sort: next,
        q: q || undefined,
        id: selectedId || undefined,
      })
    );
  }

  return (
    <Menu
      trigger={
        <button
          type="button"
          aria-label="Sort contacts"
          className={buttonClass({ variant: "ghost", size: "sm", className: "gap-1 text-ink-2" })}
        >
          <span className="text-meta text-ink-3">Sort</span>
          <span className="text-body text-ink">{active}</span>
          <ChevronDownIcon aria-hidden className="size-4 text-ink-3" />
        </button>
      }
    >
      {SORT_OPTIONS.map((option) => (
        <MenuItem
          key={option.value}
          onClick={() => pick(option.value)}
          aria-current={sort === option.value ? "true" : undefined}
        >
          {option.label}
        </MenuItem>
      ))}
    </Menu>
  );
}
