"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateContactName } from "@/app/(desk)/contacts/actions";
import { btnPrimary, deskFieldClass, pendingSpinnerClass } from "@/components/ui/deskChrome";

export function ContactNameForm({ contactId }: { contactId: string }) {
  const router = useRouter();
  const [name, setName] = useState("");
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
        Name this caller
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
