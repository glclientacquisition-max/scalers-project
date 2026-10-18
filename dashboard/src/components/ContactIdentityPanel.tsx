"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { withRoleGate } from "@/components/DeskRole";
import { Button } from "@/components/ui/Button";
import { ConfirmSheet } from "@/components/ui/ConfirmSheet";
import { Switch } from "@/components/ui/Switch";
import { dismissContactAlternateName, setContactSinglePerson } from "@/app/(desk)/contacts/actions";
import {
  alternateCallHref,
  heardDay,
  otherNamesLine,
  type ContactAlternate,
} from "@/lib/contactNameLock";

/**
 * Contact file, DESK_CONTACT_NAME_LOCK on: "This number is one person" and the other
 * names heard on this number, each removable (ConfirmSheet first). Owner and admin;
 * the role gate locks it for staff and viewers.
 */
function ContactIdentityPanelInner({
  contactId,
  name,
  singlePerson,
  lockedAt,
  alternates,
}: {
  contactId: string;
  name: string | null;
  singlePerson: boolean;
  lockedAt: string | null;
  alternates: ContactAlternate[];
}) {
  const router = useRouter();
  const [on, setOn] = useState(singlePerson);
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<ContactAlternate | null>(null);
  const [pending, start] = useTransition();
  const who = name?.trim() || "this caller";

  function toggle(next: boolean) {
    setError(null);
    setOn(next);
    start(async () => {
      const res = await setContactSinglePerson(contactId, next);
      if (!res.ok) {
        setOn(!next);
        setError(res.error || "Could not save.");
        return;
      }
      router.refresh();
    });
  }

  function confirmRemove() {
    if (!removing) return;
    const target = removing;
    setError(null);
    start(async () => {
      const res = await dismissContactAlternateName(contactId, target.name);
      setRemoving(null);
      if (!res.ok) {
        setError(res.error || "Could not remove.");
        return;
      }
      router.refresh();
    });
  }

  return (
    <section
      aria-labelledby="contact-identity"
      data-contact-identity=""
      className="rounded-2xl border border-hairline bg-surface p-4"
    >
      <h2 id="contact-identity" className="text-caption font-medium text-ink-2">
        Who uses this number
      </h2>

      <div className="mt-2 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-body font-medium text-ink">This number is one person</p>
          <p className="mt-0.5 text-meta text-ink-2">
            {on ? `Only ${who} calls from this number.` : `Turn on if only ${who} calls from this number.`}
          </p>
          {lockedAt ? <p className="mt-0.5 text-meta text-ink-2">You set this name on {heardDay(lockedAt)}.</p> : null}
        </div>
        <Switch checked={on} onCheckedChange={toggle} label="This number is one person" disabled={pending} />
      </div>

      <div className="mt-4 border-t border-hairline pt-3">
        <h3 className="text-body font-medium text-ink">Also heard as</h3>
        <p className="mt-0.5 text-meta text-ink-2" data-contact-other-names={alternates.length}>
          {otherNamesLine(alternates.length)}
        </p>
        {alternates.length ? (
          <ul className="mt-2 divide-y divide-hairline">
            {alternates.map((alt) => {
              const day = heardDay(alt.seen_at);
              const href = alternateCallHref(alt.call_id);
              return (
                <li key={alt.name} className="flex min-h-11 items-center justify-between gap-3 py-1.5">
                  <div className="min-w-0">
                    <p className="truncate text-body text-ink">{alt.name}</p>
                    {day || href ? (
                      <p className="text-meta text-ink-2">
                        {day}
                        {day && href ? " · " : ""}
                        {href ? (
                          <Link href={href} className="font-medium text-accent hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-brand">
                            View call
                          </Link>
                        ) : null}
                      </p>
                    ) : null}
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="md"
                    disabled={pending}
                    onClick={() => setRemoving(alt)}
                    aria-label={`Remove ${alt.name}`}
                  >
                    Remove
                  </Button>
                </li>
              );
            })}
          </ul>
        ) : null}
      </div>

      {error ? (
        <p role="alert" className="mt-2 text-body text-warn">
          {error}
        </p>
      ) : null}

      <ConfirmSheet
        open={removing !== null}
        title={removing ? `Remove ${removing.name}?` : "Remove name"}
        confirmLabel="Remove"
        danger
        pending={pending}
        onClose={() => setRemoving(null)}
        onConfirm={confirmRemove}
      >
        <p className="text-body text-ink-2">
          {removing?.name} comes off this contact and won&apos;t show in this list again. The calls stay in the history.
        </p>
      </ConfirmSheet>
    </section>
  );
}

export const ContactIdentityPanel = withRoleGate("contacts.import", ContactIdentityPanelInner);
