"use client";

import { withRoleGate } from "@/components/DeskRole";
import { useOptimistic, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateContactFavourite } from "@/app/(desk)/contacts/actions";
import { Button } from "@/components/ui/Button";
import { notify } from "@/components/ui/DeskNotice";
import { OPTIMISTIC_OFFLINE_ERROR } from "@/lib/optimisticAction";

function ContactFavouriteButtonInner({
  contactId,
  favourite,
}: {
  contactId: string;
  favourite: boolean;
}) {
  const router = useRouter();
  // The star flips on tap. If the save fails the transition ends without new
  // props, React drops the optimistic value and the star flips back.
  const [shown, show] = useOptimistic(favourite, (_current, next: boolean) => next);
  const [, startTransition] = useTransition();

  function toggle() {
    const next = !shown;
    startTransition(async () => {
      show(next);
      let res: { ok?: boolean; error?: string };
      try {
        res = await updateContactFavourite(contactId, next);
      } catch {
        res = { error: OPTIMISTIC_OFFLINE_ERROR };
      }
      if (!res.ok) {
        notify(res.error || "Could not save.", {
          tone: "error",
          action: { label: "Try again", run: toggle },
        });
        return;
      }
      router.refresh();
    });
  }

  return (
    <div data-contact-favourite="">
      <Button
        type="button"
        onClick={toggle}
        aria-pressed={shown}
        variant={shown ? "tonal" : "ghost"}
        size="md"
        leading={<span aria-hidden="true">★</span>}
      >
        {shown ? "Favourited" : "Add to Favourites"}
      </Button>
    </div>
  );
}

export const ContactFavouriteButton = withRoleGate("contacts.edit", ContactFavouriteButtonInner);
