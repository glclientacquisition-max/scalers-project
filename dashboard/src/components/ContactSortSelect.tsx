"use client";

import { useRouter } from "next/navigation";
import { deskFieldClass } from "@/components/ui/deskChrome";
import {
  contactsHref,
  type ContactSavedFilter,
  type ContactSort,
} from "@/lib/contactsLoad";

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
      <select
        aria-label="Sort contacts"
        value={sort}
        className={`${deskFieldClass} w-auto min-w-[8.5rem] py-1.5`}
        onChange={(event) => {
          const next = event.currentTarget.value === "name" ? "name" : "recent";
          router.replace(
            contactsHref({
              saved,
              sort: next,
              q: q || undefined,
            })
          );
        }}
      >
        <option value="recent">Last call</option>
        <option value="name">Name</option>
      </select>
    </label>
  );
}
