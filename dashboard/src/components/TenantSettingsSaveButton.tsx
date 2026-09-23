"use client";

import {
  btnPrimaryFill,
  deskShiftClass,
  focusRingVisible,
  pendingSpinnerClass,
} from "@/components/ui/deskChrome";

export const TENANT_SETTINGS_FORM_ID = "tenant-settings-form";

export function TenantSettingsSaveButton({ pending = false }: { pending?: boolean }) {
  return (
    <button
      type="submit"
      form={TENANT_SETTINGS_FORM_ID}
      disabled={pending}
      className={[
        "inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-xl px-4 text-sm",
        btnPrimaryFill,
        deskShiftClass,
        "active:scale-[0.99] motion-reduce:active:scale-100",
        focusRingVisible,
      ].join(" ")}
    >
      {pending ? (
        <>
          <span aria-hidden="true" className={pendingSpinnerClass} />
          Training
        </>
      ) : (
        <>
          <span className="sm:hidden">Save</span>
          <span className="hidden sm:inline">Save and train</span>
        </>
      )}
    </button>
  );
}
