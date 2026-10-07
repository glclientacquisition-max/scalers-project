"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Field, Input } from "@/components/ui/Field";
import { sanitizeSearchQuery } from "@/lib/callsTriage";
import {
  contactsHref,
  type ContactSavedFilter,
  type ContactSort,
} from "@/lib/contactsLoad";

export function ContactsSearch({
  q,
  saved,
  sort,
  selectedId,
}: {
  q: string;
  saved: ContactSavedFilter;
  sort: ContactSort;
  selectedId?: string | null;
}) {
  const router = useRouter();
  const [value, setValue] = useState(q);
  const savedRef = useRef(saved);
  const sortRef = useRef(sort);
  const selectedRef = useRef(selectedId);
  const wait = useRef<ReturnType<typeof setTimeout> | null>(null);
  savedRef.current = saved;
  sortRef.current = sort;
  selectedRef.current = selectedId;

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
        id: selectedRef.current || undefined,
      })
    );
  }

  return (
    <form action="/contacts" method="get" className="w-full min-w-0">
      {saved !== "recent" ? <input type="hidden" name="saved" value={saved} /> : null}
      {sort !== "recent" ? <input type="hidden" name="sort" value={sort} /> : null}
      {selectedId ? <input type="hidden" name="id" value={selectedId} /> : null}
      <Field id="contacts-search" label="Search contacts">
        {(props) => (
          <Input
            {...props}
            name="q"
            type="search"
            value={value}
            placeholder="Name or number"
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
        )}
      </Field>
    </form>
  );
}
