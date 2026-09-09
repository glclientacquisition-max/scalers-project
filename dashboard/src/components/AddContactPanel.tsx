"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createContact } from "@/app/(desk)/contacts/actions";
import {
  isContactPickerAvailable,
  mapPickedContacts,
} from "@/lib/contactImport";
import {
  compactTextareaExpandHandlers,
  settingsActionClass,
  settingsFieldClass,
  settingsPrimaryButtonClass,
} from "@/components/settingsUi";

type Draft = { name: string; phone: string; notes: string };

const emptyDraft = (): Draft => ({ name: "", phone: "", notes: "" });

export function ContactPickButton({
  available,
  onPick,
}: {
  available: boolean;
  onPick: () => void;
}) {
  if (!available) return null;
  return (
    <button
      type="button"
      onClick={onPick}
      className={settingsActionClass}
    >
      Pick from phone contacts
    </button>
  );
}

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
      const nav = navigator as Navigator & {
        contacts?: {
          select: (
            props: string[],
            opts?: { multiple?: boolean }
          ) => Promise<Array<{ name?: string[]; tel?: string[] }>>;
        };
      };
      const selected = await nav.contacts?.select(["name", "tel"], {
        multiple: true,
      });
      const mapped = mapPickedContacts(selected);
      if (!mapped.length) return;
      setDrafts(
        mapped.map((row) => ({
          name: row.name || "",
          phone: row.phone || "",
          notes: "",
        }))
      );
    } catch {
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
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 p-4 sm:items-center"
          role="presentation"
          onClick={() => !pending && setOpen(false)}
        >
          <div
            role="dialog"
            aria-labelledby="add-contact-title"
            aria-modal="true"
            className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-line bg-surface p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <h2
                id="add-contact-title"
                className="font-display text-xl tracking-tight text-ink"
              >
                Add contact
              </h2>
              <button
                type="button"
                onClick={() => !pending && setOpen(false)}
                className="rounded-lg px-2 py-1 text-sm text-ink-soft hover:bg-surface-canvas hover:text-ink"
                aria-label="Close"
              >
                Close
              </button>
            </div>

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
                <button type="submit" disabled={pending} className={settingsPrimaryButtonClass}>
                  {pending ? "Saving" : drafts.length > 1 ? `Save ${drafts.length}` : "Save"}
                </button>
                <ContactPickButton available={pickerOn} onPick={pickFromPhone} />
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
          </div>
        </div>
      ) : null}
    </>
  );
}
