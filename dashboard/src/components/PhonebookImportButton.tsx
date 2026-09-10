"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  csvFromPickedContacts,
  isContactPickerAvailable,
} from "@/lib/contactImport";
import {
  settingsActionClass,
  settingsPrimaryButtonClass,
} from "@/components/settingsUi";

export const PHONEBOOK_CSV_KEY = "scalers.contactImportCsv";

type ContactSelectResult = Array<{ name?: string[]; tel?: string[] }>;

export async function selectPhonebookContacts(): Promise<ContactSelectResult> {
  const nav = navigator as Navigator & {
    contacts?: {
      select: (
        props: string[],
        opts?: { multiple?: boolean }
      ) => Promise<ContactSelectResult>;
    };
  };
  if (typeof nav.contacts?.select !== "function") {
    throw new Error("Phone contacts are not available in this browser.");
  }
  return nav.contacts.select(["name", "tel"], { multiple: true });
}

export function ContactPickButton({
  available,
  onPick,
  label = "From this phone",
  primary = false,
}: {
  available: boolean;
  onPick: () => void;
  label?: string;
  primary?: boolean;
}) {
  if (!available) return null;
  return (
    <button
      type="button"
      onClick={onPick}
      className={primary ? settingsPrimaryButtonClass : settingsActionClass}
    >
      {label}
    </button>
  );
}

/** List-page CTA: pick on this tap, then open import preview. */
export function PhonebookImportButton() {
  const router = useRouter();
  const [available, setAvailable] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setAvailable(isContactPickerAvailable(window));
  }, []);

  async function pick() {
    setError(null);
    try {
      const selected = await selectPhonebookContacts();
      if (!selected?.length) return;
      sessionStorage.setItem(PHONEBOOK_CSV_KEY, csvFromPickedContacts(selected));
      router.push("/contacts/import");
    } catch (err) {
      if ((err as { name?: string })?.name === "AbortError") return;
      setError("Could not read phone contacts.");
    }
  }

  if (!available) return null;

  return (
    <span className="inline-flex flex-col items-end gap-1">
      <ContactPickButton available primary onPick={pick} />
      {error ? <span className="text-xs text-warn">{error}</span> : null}
    </span>
  );
}
