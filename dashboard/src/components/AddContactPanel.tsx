"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createContact } from "@/app/(desk)/contacts/actions";
import { mapPickedContacts, isContactPickerAvailable } from "@/lib/contactImport";
import {
  ContactPickButton,
  selectPhonebookContacts,
} from "@/components/PhonebookImportButton";
import {
  compactTextareaExpandHandlers,
  settingsFieldClass,
  settingsPrimaryButtonClass,
} from "@/components/settingsUi";
import { DeskDialog } from "@/components/ui/DeskDialog";
import { pendingSpinnerClass } from "@/components/ui/deskChrome";

type Draft = { name: string; phone: string; notes: string };

const emptyDraft = (): Draft => ({ name: "", phone: "", notes: "" });

export function AddContactPanel() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pickerOn, setPickerOn] = useState(false);
  const [drafts, setDrafts] = useState<Draft[]>([emptyDraft()]);
  const [error, setError] = useState<string | null>(null);
  const [existingId, setExistingId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    setPickerOn(isContactPickerAvailable(window));
  }, []);

  function reset() {
    setDrafts([emptyDraft()]);
    setError(null);
    setExistingId(null);
  }

  async function pickFromPhone() {
    setError(null);
    setExistingId(null);
    try {
      const selected = await selectPhonebookContacts();
      const mapped = mapPickedContacts(selected);
      if (!mapped.length) return;
      setDrafts(
        mapped.map((row) => ({
          name: row.name || "",
          phone: row.phone || "",
          notes: "",
        }))
      );
    } catch (err) {
      if ((err as { name?: string })?.name === "AbortError") return;
      setError("Could not read phone contacts.");
    }
  }

  function save() {
    setError(null);
    setExistingId(null);
    startTransition(async () => {
      const results = [];
      for (const draft of drafts) {
        const fd = new FormData();
        fd.set("name", draft.name);
        fd.set("phone", draft.phone);
        fd.set("notes", draft.notes);
        results.push(await createContact(fd));
      }
      const fail = results.find((row) => !row.ok);
      if (fail) {
        setError(fail.error || "Could not save.");
        setExistingId(fail.existingId || null);
        return;
      }
      const last = results[results.length - 1];
      reset();
      setOpen(false);
      if (results.length === 1 && last?.id) {
        router.push(`/contacts/${last.id}`);
        return;
      }
      router.refresh();
    });
  }

  const close = useCallback(() => {
    if (!pending) setOpen(false);
  }, [pending]);

  return (
    <>
      <button
        type="button"
        onClick={() => {
          reset();
          setOpen(true);
        }}
        className={settingsPrimaryButtonClass}
      >
        Add contact
      </button>

      {open ? (
        <DeskDialog
          title="Add contact"
          onClose={close}
          pending={pending}
          panelClassName="max-w-lg"
        >
            <form
              className="mt-5 space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                save();
              }}
            >
              {drafts.map((draft, i) => (
                <div
                  key={i}
                  className={drafts.length > 1 ? "border-b border-line pb-4" : ""}
                >
                  <label className="text-xs font-medium uppercase tracking-wide text-ink-soft">
                    Name
                    <input
                      value={draft.name}
                      onChange={(e) => {
                        const next = [...drafts];
                        next[i] = { ...draft, name: e.target.value };
                        setDrafts(next);
                      }}
                      className={settingsFieldClass}
                    />
                  </label>
                  <label className="mt-3 block text-xs font-medium uppercase tracking-wide text-ink-soft">
                    Phone
                    <input
                      value={draft.phone}
                      onChange={(e) => {
                        const next = [...drafts];
                        next[i] = { ...draft, phone: e.target.value };
                        setDrafts(next);
                      }}
                      required
                      inputMode="tel"
                      autoComplete="tel"
                      className={settingsFieldClass}
                    />
                  </label>
                  <label className="mt-3 block text-xs font-medium uppercase tracking-wide text-ink-soft">
                    Notes
                    <textarea
                      value={draft.notes}
                      onChange={(e) => {
                        const next = [...drafts];
                        next[i] = { ...draft, notes: e.target.value };
                        setDrafts(next);
                      }}
                      rows={2}
                      maxLength={2000}
                      className={`${settingsFieldClass} leading-relaxed`}
                      {...compactTextareaExpandHandlers}
                    />
                  </label>
                </div>
              ))}

              <div className="flex flex-wrap items-center gap-2">
                <button type="submit" disabled={pending} className={`${settingsPrimaryButtonClass} gap-2`}>
                  {pending ? (
                    <>
                      <span aria-hidden="true" className={pendingSpinnerClass} />
                      Saving
                    </>
                  ) : drafts.length > 1 ? (
                    `Save ${drafts.length}`
                  ) : (
                    "Save"
                  )}
                </button>
                <ContactPickButton
                  available={pickerOn}
                  onPick={pickFromPhone}
                  label="From this phone"
                />
              </div>

              {error ? (
                <p className="text-sm text-warn">
                  {error}
                  {existingId ? (
                    <>
                      {" "}
                      <a
                        href={`/contacts/${existingId}`}
                        className="font-semibold text-[#005CCC] underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0096FF]"
                      >
                        Open contact
                      </a>
                    </>
                  ) : null}
                </p>
              ) : null}
            </form>
        </DeskDialog>
      ) : null}
    </>
  );
}
