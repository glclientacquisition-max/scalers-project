"use client";

export default function SettingsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="max-w-xl rounded-2xl border border-warn/40 bg-white p-6">
      <h1 className="font-display text-2xl tracking-tight text-ink">Business settings</h1>
      <p className="mt-3 text-sm text-warn" role="alert">
        {error.message || "Something went wrong loading Business settings."}
      </p>
      <button
        type="button"
        onClick={reset}
        className="mt-4 rounded-xl bg-[#0096FF] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#0088e8]"
      >
        Try again
      </button>
    </div>
  );
}
