"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { DeskNotice } from "@/components/ui/DeskNotice";
import { deskShiftClass, focusRingVisible } from "@/components/ui/deskChrome";
import { inboxUndoArchive } from "@/lib/inboxLeadActions";
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

  const count = notice?.rows.length ?? 0;

  async function undo() {
    if (!notice || busy) return;
    setBusy(true);
    setError(null);
    // One server request restores every archived row (inboxBulkAction).
    const res = await inboxUndoArchive(notice.rows);
    if (res.error) {
      setError(res.error);
      setBusy(false);
      return;
    }
    for (const row of notice.rows) {
      patch(row.id, { hidden: false });
      if (row.callId !== row.id) patch(row.callId, { hidden: false });
    }
    dismissArchive();
    setBusy(false);
    router.refresh();
  }

  return (
    <DeskNotice open={!!notice}>
      {notice ? (
        <div className="flex w-full flex-col rounded-xl border border-hairline bg-surface shadow-xl">
          <div className="flex items-center gap-2 px-3">
            <p className="min-w-0 flex-1 truncate text-body text-ink">{inboxArchiveUndoLabel(count)}</p>
            <button
              type="button"
              disabled={busy}
              className={`inline-flex min-h-11 shrink-0 items-center px-3 text-body font-medium text-accent-deep ${deskShiftClass} ${focusRingVisible} hover:underline disabled:opacity-50`}
              onClick={() => void undo()}
            >
              {busy ? "Saving" : "Undo"}
            </button>
          </div>
          {error ? (
            <p className="px-3 pb-2 text-meta text-warn" role="alert">
              {error}
            </p>
          ) : null}
        </div>
      ) : null}
    </DeskNotice>
  );
}
