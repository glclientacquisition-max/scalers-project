"use client";

import { useRouter } from "next/navigation";
import { DeskSelect } from "@/components/ui/DeskSelect";
import { deskFieldClass } from "@/components/ui/deskChrome";
import {
  contactsHref,
  type ContactSavedFilter,
  type ContactSort,
} from "@/lib/contactsLoad";

const SORT_OPTIONS = [
  { value: "recent" as const, label: "Last call" },
  { value: "name" as const, label: "Name" },
];

export function ContactSortSelect({
  saved,
  sort,
  q,
}: {
  saved: ContactSavedFilter;
  sort: ContactSort;
  q: string;
}) {
  const router = useRouter();

  return (
    <label className="inline-flex min-h-11 min-w-0 items-center gap-2 text-sm text-ink-soft">
      <span className="shrink-0">Sort</span>
      <DeskSelect
        aria-label="Sort contacts"
        value={sort}
        className={`${deskFieldClass} w-auto min-w-[8.5rem] py-1.5`}
        options={SORT_OPTIONS}
        onChange={(next) => {
          router.replace(
            contactsHref({
              saved,
              sort: next,
              q: q || undefined,
            })
          );
        }}
      />
    </label>
  );
}
