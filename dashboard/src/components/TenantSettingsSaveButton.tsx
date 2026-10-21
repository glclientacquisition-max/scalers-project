"use client";

import { CheckIcon } from "@heroicons/react/20/solid";
import {
  btnPrimaryFill,
  deskShiftClass,
  focusRingVisible,
  pendingSpinnerClass,
} from "@/components/ui/deskChrome";

export const TENANT_SETTINGS_FORM_ID = "tenant-settings-form";

/**
 * Settings header Save. Reads "Saving" while the save runs and "Saved" for a
 * moment after it lands (useFormSave justSaved), then goes back to "Save".
 */
export function TenantSettingsSaveButton({
  pending = false,
  saved = false,
  form = TENANT_SETTINGS_FORM_ID,
}: {
  pending?: boolean;
  saved?: boolean;
  form?: string;
}) {
  return (
    <button
      type="submit"
      form={form}
      disabled={pending}
      data-save-state={pending ? "saving" : saved ? "saved" : "idle"}
      className={[
        "inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-xl px-4 text-body",
        btnPrimaryFill,
        deskShiftClass,
        "active:scale-[0.99] motion-reduce:active:scale-100",
        focusRingVisible,
      ].join(" ")}
    >
      {pending ? (
        <>
          <span aria-hidden="true" className={pendingSpinnerClass} />
          Saving
        </>
      ) : saved ? (
        <>
          <CheckIcon aria-hidden="true" className="size-4" />
          Saved
        </>
      ) : (
        "Save"
      )}
    </button>
  );
}
