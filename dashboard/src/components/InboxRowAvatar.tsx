"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { createPortal } from "react-dom";
import { ensureInboxContact } from "@/app/(desk)/contacts/actions";
import { DeskDialog } from "@/components/ui/DeskDialog";
import { RowIdentity } from "@/components/ui/deskRow";
import { focusRingVisible, pendingSpinnerInkClass } from "@/components/ui/deskChrome";
import { contactFromInboxHref, type InboxReturn } from "@/lib/inboxHref";

const hitClass = [
  "inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full",
  focusRingVisible,
].join(" ");

function hasDialablePhone(phone: string | null): boolean {
  const value = phone?.trim() || "";
  return Boolean(value) && value.toLowerCase() !== "unknown";
}

/**
 * Identity circle is a contact hit. The row body still opens the conversation.
 * Linked when a contact file exists. Resolves or creates one from phone when it can.
 * Stub dialog when there is no phone and no contact.
 */
export function InboxRowAvatar({
  name,
  phone,
  contactHref,
  ret,
}: {
  name: string | null;
  phone: string | null;
  contactHref: string | null;
  ret?: InboxReturn;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const who = name?.trim() || "Caller";
  const face = busy ? (
    <span aria-hidden="true" className={pendingSpinnerInkClass} />
  ) : (
    <RowIdentity name={name} />
  );
  const stub = open
    ? createPortal(
        <DeskDialog title={who} onClose={() => setOpen(false)}>
          <p className="mt-2 font-mono text-sm text-ink">{phone?.trim() || "No phone"}</p>
          <p className="mt-4 text-sm text-ink-soft">{error || "No history yet"}</p>
        </DeskDialog>,
        document.body
      )
    : null;

  if (contactHref) {
    return (
      <Link href={contactHref} aria-label={`${who} profile`} className={hitClass}>
        <RowIdentity name={name} />
      </Link>
    );
  }

  if (hasDialablePhone(phone)) {
    return (
      <>
        <button
          type="button"
          aria-label={`${who} profile`}
          disabled={busy}
          className={hitClass}
          onClick={async (event) => {
            event.preventDefault();
            event.stopPropagation();
            setBusy(true);
            setError(null);
            const res = await ensureInboxContact({ phone, name });
            setBusy(false);
            if (res.id) {
              router.push(contactFromInboxHref(res.id, ret || {}));
              router.refresh();
              return;
            }
            setError(res.stub ? "No history yet" : res.error || "Could not save contact.");
            setOpen(true);
          }}
        >
          {face}
        </button>
        {stub}
      </>
    );
  }

  return (
    <>
      <button
        type="button"
        aria-label={`${who} profile`}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={hitClass}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setError(null);
          setOpen(true);
        }}
      >
        <RowIdentity name={name} />
      </button>
      {stub}
    </>
  );
}
