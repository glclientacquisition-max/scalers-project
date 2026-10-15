"use client";

import { useEffect, useRef, useState } from "react";
import { buttonClass, pendingDotClass } from "@/components/ui/Button";

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
    <button ref={ref} type="submit" aria-disabled={pending || undefined} className={buttonClass({ variant: "primary", size: "lg", block: true })}>
      {pending ? <span aria-hidden="true" className={pendingDotClass} /> : null}
      {pending ? pendingLabel : label}
    </button>
  );
}
