"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { DeskNotice } from "@/components/ui/DeskNotice";
import { deskShiftClass, focusRingVisible } from "@/components/ui/deskChrome";
import { inboxUndoArchive, inboxUndoArchiveCascade } from "@/lib/inboxLeadActions";
import { inboxUndoOutcomeText } from "@/lib/inboxBulk";
import { inboxCascadeUndoText } from "@/lib/inboxArchiveCascade";
import { inboxArchiveUndoLabel, type InboxArchiveUndoPayload } from "@/lib/inboxArchiveUndo";

const RESULT_MS = 4000;

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
  /** What Undo restored, shown briefly after the archive notice closes. */
  const [result, setResult] = useState<string | null>(null);

  useEffect(() => {
    setBusy(false);
    setError(null);
    if (notice) setResult(null);
  }, [notice]);

  useEffect(() => {
    if (!result) return;
    const timer = setTimeout(() => setResult(null), RESULT_MS);
    return () => clearTimeout(timer);
  }, [result]);

  const count = notice?.rows.length ?? 0;
  const holds = notice?.holdIds?.length ?? 0;
  const visits = notice?.visitIds?.length ?? 0;

  async function undo() {
    if (!notice || busy) return;
    setBusy(true);
    setError(null);
    if (notice.undoId) {
      // One transaction restores the calls and the requests archived with
      // them (inbox_undo_archive); rows changed since are counted, not restored.
      const res = await inboxUndoArchiveCascade({
        undoId: notice.undoId,
        rows: notice.rows,
        requests: notice.requests,
      });
      if (res.error) {
        setError(res.error);
        setBusy(false);
        return;
      }
      for (const row of res.restored) {
        patch(row.id, { hidden: false });
        if (row.callId !== row.id) patch(row.callId, { hidden: false });
      }
      setResult(
        inboxCascadeUndoText({
          restoredCalls: res.restoredCalls,
          restoredHolds: res.restoredHolds,
          restoredVisits: res.restoredVisits,
          changedSince: res.changedSince,
          alreadyUndone: res.alreadyUndone,
        })
      );
      dismissArchive();
      setBusy(false);
      router.refresh();
      return;
    }
    // One server request restores exactly the archived rows (inboxBulkAction).
    const res = await inboxUndoArchive(notice.rows);
    if (res.error) {
      setError(res.error);
      setBusy(false);
      return;
    }
    for (const row of res.restored) {
      patch(row.id, { hidden: false });
      if (row.callId !== row.id) patch(row.callId, { hidden: false });
    }
    const outcome = inboxUndoOutcomeText(res);
    if (outcome) {
      // Some rows changed since the archive: say so, never count them as restored.
      setError(outcome);
      setBusy(false);
      router.refresh();
      return;
    }
    dismissArchive();
    setBusy(false);
    router.refresh();
  }

  return (
    <DeskNotice open={!!notice || !!result}>
      {!notice && result ? (
        <div className="flex w-full flex-col rounded-xl border border-hairline bg-surface shadow-xl">
          <p className="min-h-11 px-3 py-3 text-body text-ink" role="status">
            {result}
          </p>
        </div>
      ) : notice ? (
        <div className="flex w-full flex-col rounded-xl border border-hairline bg-surface shadow-xl">
          <div className="flex items-center gap-2 px-3">
            <p className="min-w-0 flex-1 py-2 text-body text-ink">{inboxArchiveUndoLabel(count, holds, visits)}</p>
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
