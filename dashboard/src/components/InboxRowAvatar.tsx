"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { createPortal } from "react-dom";
import { ensureInboxContact } from "@/app/(desk)/contacts/actions";
import { DeskDialog } from "@/components/ui/DeskDialog";
import { useInboxRowUi } from "@/components/InboxRowUi";
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
  itemId,
}: {
  name: string | null;
  phone: string | null;
  contactHref: string | null;
  ret?: InboxReturn;
  itemId?: string;
}) {
  const router = useRouter();
  const ui = useInboxRowUi();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const who = name?.trim() || "Caller";
  const selected = Boolean(itemId && ui?.selected.includes(itemId));
  const face = busy ? (
    <span aria-hidden="true" className={pendingSpinnerInkClass} />
  ) : (
    <RowIdentity name={name} />
  );

  if (ui?.selecting && itemId) {
    return (
      <button
        type="button"
        aria-label="Toggle selection"
        aria-pressed={selected}
        className={`${hitClass} relative`}
        onClick={() => ui.toggle(itemId)}
      >
        <RowIdentity name={name} />
        {selected ? (
          <span className="absolute -bottom-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-[#005CCC] text-white">
            <svg viewBox="0 0 16 16" className="h-3 w-3" fill="none" aria-hidden="true">
              <path d="M3.4 8.2 6.4 11.2 12.6 4.8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </span>
        ) : null}
      </button>
    );
  }
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
