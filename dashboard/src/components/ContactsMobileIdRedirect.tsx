"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  contactProfileHref,
  type ContactSavedFilter,
  type ContactSort,
} from "@/lib/contactsLoad";

/** On phone, `/contacts?id=` opens the nested contact file route instead of split pane. */
export function ContactsMobileIdRedirect({
  id,
  saved,
  sort,
  q,
}: {
  id: string;
  saved: ContactSavedFilter;
  sort: ContactSort;
  q: string;
}) {
  const router = useRouter();

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 1023px)");
    function go() {
      if (!mq.matches) return;
      router.replace(
        contactProfileHref(id, { saved, sort, q: q || undefined })
      );
    }
    go();
    mq.addEventListener("change", go);
    return () => mq.removeEventListener("change", go);
  }, [id, q, router, saved, sort]);

  return null;
}
