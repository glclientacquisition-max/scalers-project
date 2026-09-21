"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { sanitizeSearchQuery } from "@/lib/callsTriage";
import {
  contactsHref,
  type ContactSavedFilter,
  type ContactSort,
} from "@/lib/contactsLoad";
import { deskFieldClass } from "@/components/ui/deskChrome";

export function ContactsSearch({
  q,
  saved,
  sort,
}: {
  q: string;
  saved: ContactSavedFilter;
  sort: ContactSort;
}) {
  const router = useRouter();
  const [value, setValue] = useState(q);
  const savedRef = useRef(saved);
  const sortRef = useRef(sort);
  const wait = useRef<ReturnType<typeof setTimeout> | null>(null);
  savedRef.current = saved;
  sortRef.current = sort;

  useEffect(() => {
    setValue(q);
  }, [q]);

  useEffect(() => {
    return () => {
      if (wait.current) clearTimeout(wait.current);
    };
  }, []);

  function sync(next: string) {
    router.replace(
      contactsHref({
        saved: savedRef.current,
        sort: sortRef.current,
        q: sanitizeSearchQuery(next) || undefined,
      })
    );
  }

  return (
    <form action="/contacts" method="get" className="w-full min-w-0">
      {saved !== "all" ? <input type="hidden" name="saved" value={saved} /> : null}
      {sort !== "recent" ? <input type="hidden" name="sort" value={sort} /> : null}
      <label className="sr-only" htmlFor="contacts-search">
        Search contacts
      </label>
      <input
        id="contacts-search"
        name="q"
        type="search"
        value={value}
        placeholder="Name or number"
        className={deskFieldClass}
        onChange={(event) => {
          const next = event.currentTarget.value.slice(0, 64);
          setValue(next);
          if (wait.current) clearTimeout(wait.current);
          if (!next.trim()) {
            sync(next);
            return;
          }
          wait.current = setTimeout(() => sync(next), 300);
        }}
      />
    </form>
  );
}
