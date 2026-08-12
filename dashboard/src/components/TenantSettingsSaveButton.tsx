"use client";

export const TENANT_SETTINGS_FORM_ID = "tenant-settings-form";

export function TenantSettingsSaveButton({ pending = false }: { pending?: boolean }) {
  return (
    <button
      type="submit"
      form={TENANT_SETTINGS_FORM_ID}
      disabled={pending}
      className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#0096FF] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[#0088e8] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0096FF]/40 focus-visible:ring-offset-2 disabled:opacity-60 sm:w-auto sm:min-w-[10rem] sm:px-6"
    >
      {pending ? (
        <>
          <span
            aria-hidden="true"
            className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white"
          />
          Training…
        </>
      ) : (
        <>
          <span className="sm:hidden">Save</span>
          <span className="hidden sm:inline">Save &amp; train assistant</span>
        </>
      )}
    </button>
  );
}
