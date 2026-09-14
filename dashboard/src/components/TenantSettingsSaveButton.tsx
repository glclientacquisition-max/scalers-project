"use client";

import {
  btnPrimaryFill,
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
        "inline-flex min-h-14 w-full items-center justify-center gap-2 rounded-xl px-6 py-3.5 text-base",
        btnPrimaryFill,
        "transition-[background-color,transform,opacity] duration-150 active:scale-[0.99] motion-reduce:active:scale-100",
        focusRingVisible,
        "sm:w-auto sm:min-w-[12rem]",
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
