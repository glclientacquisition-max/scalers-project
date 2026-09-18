"use client";

import Link from "next/link";
import { useState } from "react";
import { createPortal } from "react-dom";
import { DeskDialog } from "@/components/ui/DeskDialog";
import { RowIdentity } from "@/components/ui/deskRow";
import { focusRingVisible } from "@/components/ui/deskChrome";

const hitClass = [
  "inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full",
  focusRingVisible,
].join(" ");

/**
 * Identity circle is a contact hit. The row body still opens the conversation.
 * Linked when a contact file exists. Stub dialog when it does not.
 */
export function InboxRowAvatar({
  name,
  phone,
  contactHref,
}: {
  name: string | null;
  phone: string | null;
  contactHref: string | null;
}) {
  const [open, setOpen] = useState(false);
  const who = name?.trim() || "Caller";
  const face = <RowIdentity name={name} />;

  if (contactHref) {
    return (
      <Link href={contactHref} aria-label={`${who} profile`} className={hitClass}>
        {face}
      </Link>
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
          setOpen(true);
        }}
      >
        {face}
      </button>
      {open
        ? createPortal(
            <DeskDialog title={who} onClose={() => setOpen(false)}>
              <p className="mt-2 font-mono text-sm text-ink">{phone?.trim() || "No phone"}</p>
              <p className="mt-4 text-sm text-ink-soft">No history yet</p>
            </DeskDialog>,
            document.body
          )
        : null}
    </>
  );
}
