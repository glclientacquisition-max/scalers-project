"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateContactName } from "@/app/(desk)/contacts/actions";
import { isJunkCallerName } from "@/lib/callerNameQuality";
import { contactStripTitle } from "@/lib/contactStrip";
import {
  btnPrimary,
  deskFieldClass,
  deskHitClass,
  deskShiftClass,
  focusRingVisible,
  pendingSpinnerClass,
} from "@/components/ui/deskChrome";

export function ContactNameForm({
  contactId,
  initialName = "",
  title,
  variant = "reveal",
}: {
  contactId: string;
  initialName?: string | null;
  title?: string;
  variant?: "reveal" | "row";
}) {
  const router = useRouter();
  const junk = isJunkCallerName(initialName);
  const [name, setName] = useState(junk ? "" : String(initialName || "").trim());
  const [open, setOpen] = useState(variant === "row" ? false : junk);
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
      setOpen(false);
      router.refresh();
    });
  }

  const form = (
    <form
      data-contact-name-form=""
      className={variant === "row" ? "flex min-w-0 flex-wrap items-center gap-2" : "space-y-2"}
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <label htmlFor={`contact-name-${contactId}`} className="sr-only">
        {junk ? "Name this caller" : "Name"}
      </label>
      <input
        id={`contact-name-${contactId}`}
        value={name}
        onChange={(e) => setName(e.target.value)}
        autoComplete="name"
        autoCapitalize="words"
        className={deskFieldClass}
      />
      <button
        type="submit"
        disabled={pending}
        className={`${btnPrimary} gap-2 ${variant === "row" ? "" : "w-full sm:w-auto"}`}
      >
        {pending ? <span aria-hidden="true" className={pendingSpinnerClass} /> : null}
        <span>Save</span>
      </button>
      {error ? <p className="w-full text-sm text-warn">{error}</p> : null}
    </form>
  );

  if (variant === "row") {
    if (!junk && String(initialName || "").trim()) return null;
    if (!open) {
      return (
        <button
          type="button"
          data-contact-add-name=""
          onClick={() => setOpen(true)}
          className={`text-sm font-medium text-[#005CCC] ${deskShiftClass} ${focusRingVisible} rounded-md px-1`}
        >
          + Add name
        </button>
      );
    }
    return form;
  }

  return (
    <div data-contact-name-form="" className="min-w-0">
      <div className="flex min-w-0 items-start gap-1">
        <h1 className="min-w-0 font-display text-[clamp(1.5rem,2.4vw,2rem)] font-semibold leading-tight tracking-tight text-ink">
          {title || contactStripTitle(initialName, true)}
        </h1>
        <button
          type="button"
          aria-label="Edit name"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
          className={`${deskHitClass} text-ink-soft ${deskShiftClass} ${focusRingVisible}`}
        >
          <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4" aria-hidden="true">
            <path
              d="M12.4 4.4l3.2 3.2-8.3 8.3H4.1v-3.2l8.3-8.3Z"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </div>
      {open ? <div className="mt-2">{form}</div> : null}
    </div>
  );
}
