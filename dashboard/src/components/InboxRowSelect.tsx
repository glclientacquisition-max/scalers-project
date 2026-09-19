"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { useInboxRowUi } from "@/components/InboxRowUi";
import { DeskRowHit, deskRowActionClass, deskRowHitClass } from "@/components/ui/deskRowHit";
import {
  btnGhost,
  btnPrimary,
  deskHitClass,
  deskShiftClass,
  focusRingVisible,
} from "@/components/ui/deskChrome";
import {
  inboxArchive,
  inboxConfirm,
  inboxHoldDone,
  inboxMarkDone,
  inboxUnarchive,
} from "@/lib/inboxLeadActions";
import { writeInboxArchiveUndo } from "@/lib/inboxArchiveUndo";
import { inboxBulkActions, type InboxListActionId } from "@/lib/inboxListVerbs";
import { itemIsArchived, type InboxItem } from "@/lib/inboxPurpose";

const iconHit = [
  deskHitClass,
  deskShiftClass,
  focusRingVisible,
  "text-ink-soft hover:bg-surface-muted hover:text-ink disabled:opacity-50",
].join(" ");

function CloseGlyph() {
  return (
    <svg viewBox="0 0 16 16" className="h-5 w-5" fill="none" aria-hidden="true">
      <path
        d="M4 4l8 8M12 4l-8 8"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function InboxRowCheck({ item }: { item: InboxItem }) {
  const ui = useInboxRowUi();
  if (!ui) return null;
  const who = item.callerName?.trim() || "Caller";
  const on = ui.selected.includes(item.id);
  return (
    <label
      className={[
        deskRowActionClass,
        "inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg",
        focusRingVisible,
        ui.selecting
          ? "hidden md:inline-flex"
          : "hidden md:inline-flex opacity-50 hover:opacity-100 focus-within:opacity-100 has-[:checked]:opacity-100",
      ].join(" ")}
    >
      <span className="sr-only">Select {who}</span>
      <input
        type="checkbox"
        checked={on}
        onChange={() => (ui.selecting ? ui.toggle(item.id) : ui.enter(item.id))}
        className="h-4 w-4 shrink-0 accent-[#005CCC] focus:outline-none focus:ring-2 focus:ring-[#0096FF]"
      />
    </label>
  );
}

export function InboxRowHit({
  href,
  label,
  itemId,
}: {
  href: string | null | undefined;
  label: string;
  itemId: string;
}) {
  const ui = useInboxRowUi();
  if (ui?.selecting) {
    return (
      <button
        type="button"
        aria-label="Toggle selection"
        className={deskRowHitClass}
        onClick={() => ui.toggle(itemId)}
      />
    );
  }
  return <DeskRowHit href={href} label={label} />;
}

export function InboxPhoneOpen({
  href,
  itemId,
  children,
}: {
  href: string | null;
  itemId: string;
  children: ReactNode;
}) {
  const ui = useInboxRowUi();
  if (ui?.selecting) {
    return (
      <button
        type="button"
        aria-label="Toggle selection"
        className="flex min-w-0 flex-1 items-center rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        onClick={() => ui.toggle(itemId)}
      >
        {children}
      </button>
    );
  }
  if (!href) {
    return <div className="flex min-w-0 flex-1 items-center">{children}</div>;
  }
  return (
    <Link
      href={href}
      aria-label="Conversation"
      className="flex min-w-0 flex-1 items-center rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
    >
      {children}
    </Link>
  );
}

export function InboxDockIdle({ children }: { children: ReactNode }) {
  const ui = useInboxRowUi();
  if (ui?.selecting) return null;
  return children;
}

export function InboxSelectChrome({
  items,
  children,
}: {
  items: InboxItem[];
  children: ReactNode;
}) {
  const ui = useInboxRowUi();
  return (
    <>
      <div className={ui?.selecting ? "hidden" : undefined}>{children}</div>
      <InboxBulkBar items={items} />
    </>
  );
}

export function InboxBulkBar({ items }: { items: InboxItem[] }) {
  const ui = useInboxRowUi();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!ui || !ui.selecting) return null;

  const { selected, patch, clear } = ui;
  const chosen = items.filter((item) => selected.includes(item.id));
  const actions = inboxBulkActions(chosen);

  async function run(kind: InboxListActionId) {
    if (kind === "pin" || kind === "unpin") return;
    setBusy(true);
    setError(null);
    const archivedRows: { id: string; callId: string }[] = [];
    for (const item of chosen) {
      if (kind === "confirm" && String(item.job?.status || "").toLowerCase() !== "requested") {
        continue;
      }
      if (kind === "done" && String(item.hold?.status || "").toLowerCase() !== "open") {
        continue;
      }
      if (kind === "mark_done" && (item.job || item.hold || itemIsArchived(item))) {
        continue;
      }
      if (kind === "archive" && itemIsArchived(item)) continue;
      if (kind === "unarchive" && !itemIsArchived(item)) continue;
      const res =
        kind === "confirm"
          ? await inboxConfirm(item)
          : kind === "done"
            ? await inboxHoldDone(item)
            : kind === "mark_done"
              ? await inboxMarkDone(item)
              : kind === "unarchive"
                ? await inboxUnarchive(item)
                : await inboxArchive(item);
      if (res.error) {
        if (archivedRows.length) writeInboxArchiveUndo(archivedRows);
        setError(res.error);
        setBusy(false);
        return;
      }
      if (kind === "archive" && item.callId) {
        archivedRows.push({ id: item.id, callId: item.callId });
      }
      if (kind === "archive" || kind === "unarchive") {
        patch(item.id, { hidden: true });
      }
    }
    if (archivedRows.length) writeInboxArchiveUndo(archivedRows);
    if (kind === "done" || kind === "archive" || kind === "unarchive" || kind === "confirm" || kind === "mark_done") {
      clear();
    }
    setBusy(false);
    router.refresh();
  }

  return (
    <div className="sticky top-[var(--desk-header-h)] z-20 -mx-4 mt-0 flex min-h-12 flex-wrap items-center gap-1 border-b border-line bg-surface px-2 sm:-mx-6">
      <button type="button" className={iconHit} disabled={busy} aria-label="Close" onClick={() => clear()}>
        <CloseGlyph />
      </button>
      <p className="mr-auto min-w-8 text-sm font-medium tabular-nums text-ink">{chosen.length}</p>
      {actions.map((action) => {
        const filled = action.id === "confirm" || action.id === "done";
        return (
          <button
            key={action.id}
            type="button"
            className={filled ? btnPrimary : btnGhost}
            disabled={busy}
            aria-label={action.label}
            onClick={() => run(action.id)}
          >
            {busy ? "Saving" : action.label}
          </button>
        );
      })}
      {error ? (
        <p className="w-full text-xs text-warn" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
