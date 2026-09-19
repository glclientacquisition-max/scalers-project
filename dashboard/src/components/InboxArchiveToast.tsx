"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { deskShiftClass, focusRingVisible } from "@/components/ui/deskChrome";
import { updateLeadStatus } from "@/app/(desk)/calls/actions";
import { inboxArchiveUndoLabel, type InboxArchiveUndoPayload } from "@/lib/inboxArchiveUndo";

export function InboxArchiveToast({
  notice,
  patch,
  dismissArchive,
}: {
  notice: InboxArchiveUndoPayload | null;
  patch: (id: string, next: { hidden: boolean }) => void;
  dismissArchive: () => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setBusy(false);
    setError(null);
  }, [notice]);

  if (!notice || typeof document === "undefined") return null;

  const count = notice.rows.length;

  async function undo() {
    if (!notice || busy) return;
    setBusy(true);
    setError(null);
    for (const row of notice.rows) {
      const res = await updateLeadStatus(row.callId, "new");
      if (res.error) {
        setError(res.error);
        setBusy(false);
        return;
      }
      patch(row.id, { hidden: false });
      if (row.callId !== row.id) patch(row.callId, { hidden: false });
    }
    dismissArchive();
    setBusy(false);
    router.refresh();
  }

  return createPortal(
    <div
      className="fixed inset-x-0 z-30 flex justify-center px-4 bottom-[calc(var(--desk-tabbar-h)+env(safe-area-inset-bottom,0px)+0.75rem)] md:bottom-6"
      role="status"
      aria-live="polite"
    >
      <div className="flex w-full max-w-md flex-col rounded-xl border border-line bg-surface shadow-xl">
        <div className="flex items-center gap-2 px-3">
          <p className="min-w-0 flex-1 truncate text-sm text-ink">{inboxArchiveUndoLabel(count)}</p>
          <button
            type="button"
            disabled={busy}
            className={`inline-flex min-h-11 shrink-0 items-center px-3 text-sm font-medium text-accent-deep ${deskShiftClass} ${focusRingVisible} hover:underline disabled:opacity-50`}
            onClick={() => void undo()}
          >
            {busy ? "Saving" : "Undo"}
          </button>
        </div>
        {error ? (
          <p className="px-3 pb-2 text-xs text-warn" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </div>,
    document.body
  );
}
