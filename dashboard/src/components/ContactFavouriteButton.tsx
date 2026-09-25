"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateContactFavourite } from "@/app/(desk)/contacts/actions";
import { deskShiftClass, pendingSpinnerInkClass } from "@/components/ui/deskChrome";

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
        className={[
          "inline-flex min-h-11 items-center text-sm font-medium",
          deskShiftClass,
          "focus:outline-none focus:ring-2 focus:ring-[#0096FF]",
          favourite
            ? "rounded-full bg-[#005CCC] px-3.5 text-white"
            : "rounded-md text-[#005CCC] hover:underline",
        ].join(" ")}
      >
        {pending ? (
          <span aria-hidden="true" className={`${pendingSpinnerInkClass} mr-2`} />
        ) : (
          <span aria-hidden="true" className="mr-1.5">
            ★
          </span>
        )}
        {favourite ? "Favourited" : "Add to Favourites"}
      </button>
      {error ? <p className="mt-2 text-sm text-warn">{error}</p> : null}
    </div>
  );
}
