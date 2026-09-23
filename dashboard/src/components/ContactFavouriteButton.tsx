"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateContactFavourite } from "@/app/(desk)/contacts/actions";
import { btnGhost, pendingSpinnerInkClass } from "@/components/ui/deskChrome";

export function ContactFavouriteButton({
  contactId,
  favourite,
}: {
  contactId: string;
  favourite: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function toggle() {
    setError(null);
    startTransition(async () => {
      const res = await updateContactFavourite(contactId, !favourite);
      if (!res.ok) {
        setError(res.error || "Could not save.");
        return;
      }
      router.refresh();
    });
  }

  return (
    <div data-contact-favourite="">
      <button
        type="button"
        disabled={pending}
        onClick={toggle}
        aria-pressed={favourite}
        className={`${btnGhost} w-full sm:w-auto`}
      >
        {pending ? (
          <span aria-hidden="true" className={`${pendingSpinnerInkClass} mr-2`} />
        ) : null}
        {favourite ? "Remove from Favourites" : "Add to Favourites"}
      </button>
      {error ? <p className="mt-2 text-sm text-warn">{error}</p> : null}
    </div>
  );
}