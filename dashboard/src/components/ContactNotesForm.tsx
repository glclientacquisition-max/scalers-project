"use client";

import { useState, useTransition } from "react";
import { updateContactNotes } from "@/app/(desk)/contacts/actions";
import {
  compactTextareaExpandHandlers,
  settingsFieldClass,
  settingsPrimaryButtonClass,
} from "@/components/settingsUi";

export function ContactNotesForm({
  contactId,
  initial,
}: {
  contactId: string;
  initial: string;
}) {
  const [notes, setNotes] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function save() {
    setError(null);
    startTransition(async () => {
      const res = await updateContactNotes(contactId, notes);
      if (!res.ok) setError(res.error || "Could not save.");
    });
  }

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <label htmlFor="contact-notes" className="text-xs font-medium uppercase tracking-wide text-ink-soft">
        Notes
      </label>
      <textarea
        id="contact-notes"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        rows={2}
        maxLength={2000}
        className={`${settingsFieldClass} leading-relaxed`}
        {...compactTextareaExpandHandlers}
      />
      <button type="submit" disabled={pending} className={settingsPrimaryButtonClass}>
        Save
      </button>
      {error ? <p className="text-sm text-warn">{error}</p> : null}
    </form>
  );
}
