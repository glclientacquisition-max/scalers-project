"use client";

import { useEffect, useRef, useState } from "react";
import { btnPrimary, pendingSpinnerClass } from "@/components/ui/deskChrome";

/** Submit for a native POST form: shows progress and blocks a second submit. Resets on back/forward cache. */
export function PendingSubmit({ label, pendingLabel }: { label: string; pendingLabel: string }) {
  const ref = useRef<HTMLButtonElement>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    const form = ref.current?.form;
    if (!form) return;
    const onSubmit = (event: SubmitEvent) => {
      if (pending) {
        event.preventDefault();
        return;
      }
      if (form.checkValidity()) setPending(true);
    };
    const onShow = () => setPending(false);
    form.addEventListener("submit", onSubmit);
    window.addEventListener("pageshow", onShow);
    return () => {
      form.removeEventListener("submit", onSubmit);
      window.removeEventListener("pageshow", onShow);
    };
  }, [pending]);

  return (
    <button ref={ref} type="submit" aria-disabled={pending || undefined} className={`${btnPrimary} w-full gap-2`}>
      {pending ? <span aria-hidden="true" className={pendingSpinnerClass} /> : null}
      {pending ? pendingLabel : label}
    </button>
  );
}
