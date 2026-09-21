"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateContactName } from "@/app/(desk)/contacts/actions";
import { isJunkCallerName } from "@/lib/callerNameQuality";
import { btnPrimary, deskFieldClass, pendingSpinnerClass } from "@/components/ui/deskChrome";

export function ContactNameForm({
  contactId,
  initialName = "",
}: {
  contactId: string;
  initialName?: string | null;
}) {
  const router = useRouter();
  const junk = isJunkCallerName(initialName);
  const [name, setName] = useState(junk ? "" : String(initialName || "").trim());
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function save() {
    setError(null);
    startTransition(async () => {
      const res = await updateContactName(contactId, name);
      if (!res.ok) {
        setError(res.error || "Could not save.");
        return;
      }
      router.refresh();
    });
  }

  return (
    <form
      data-contact-name-form=""
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <label
        htmlFor="contact-name"
        className="text-xs font-medium uppercase tracking-wide text-ink-soft"
      >
        {junk ? "Name this caller" : "Name"}
      </label>
      <input
        id="contact-name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        autoComplete="name"
        autoCapitalize="words"
        className={deskFieldClass}
      />
      <button
        type="submit"
        disabled={pending}
        className={`${btnPrimary} w-full gap-2 sm:w-auto`}
      >
        {pending ? <span aria-hidden="true" className={pendingSpinnerClass} /> : null}
        <span>Save</span>
      </button>
      {error ? <p className="text-sm text-warn">{error}</p> : null}
    </form>
  );
}
