"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { useInboxRowUi } from "@/components/InboxRowUi";
import { DeskRowHit, deskRowActionClass, deskRowHitClass } from "@/components/ui/deskRowHit";
import {
  btnDock,
  btnGhost,
  btnPrimary,
  deskHitClass,
  deskShiftClass,
  focusRingVisible,
  pendingSpinnerClass,
  pendingSpinnerInkClass,
} from "@/components/ui/deskChrome";
import {
  inboxArchive,
  inboxMarkDone,
  inboxTogglePin,
  inboxUnarchive,
} from "@/lib/inboxLeadActions";
import { inboxCanMarkDone } from "@/lib/inboxListVerbs";
import { itemIsArchived, type InboxItem } from "@/lib/inboxPurpose";

const iconHit = [
  deskHitClass,
  deskShiftClass,
  focusRingVisible,
  "text-ink-soft hover:bg-surface-muted hover:text-ink disabled:opacity-50",
].join(" ");

function BackGlyph() {
  return (
    <svg viewBox="0 0 16 16" className="h-5 w-5" fill="none" aria-hidden="true">
      <path
        d="M10.2 3.2 5.4 8l4.8 4.8"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function PinGlyph() {
  return (
    <svg viewBox="0 0 16 16" className="h-4 w-4" fill="currentColor" aria-hidden="true">
      <path d="M9.4 1.8 8 3.2 6.1 2.7 4.8 4l2.7 2.7-.9 3.1 1.1 1.1 3.1-.9L13 12.7l1.3-1.3-.5-1.9 1.4-1.4-1.4-1.4z" />
    </svg>
  );
}

function ArchiveGlyph() {
  return (
    <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" aria-hidden="true">
      <path
        d="M2.5 5.2h11v7.3c0 .6-.5 1.1-1.1 1.1H3.6c-.6 0-1.1-.5-1.1-1.1z"
        stroke="currentColor"
        strokeWidth="1.4"
      />
      <path d="M2.2 3.4h11.6v1.8H2.2z" stroke="currentColor" strokeWidth="1.4" />
      <path d="M8 7.2v3.4M6.3 9.1 8 10.8l1.7-1.7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function UnarchiveGlyph() {
  return (
    <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" aria-hidden="true">
      <path
        d="M2.5 5.2h11v7.3c0 .6-.5 1.1-1.1 1.1H3.6c-.6 0-1.1-.5-1.1-1.1z"
        stroke="currentColor"
        strokeWidth="1.4"
      />
      <path d="M2.2 3.4h11.6v1.8H2.2z" stroke="currentColor" strokeWidth="1.4" />
      <path d="M8 10.6V7.2M6.3 8.3 8 6.6l1.7 1.7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
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
          : "hidden opacity-0 [@media(hover:hover)_and_(pointer:fine)]:inline-flex group-hover:opacity-100 focus-within:opacity-100",
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
      <div className={ui?.selecting ? "max-md:hidden" : undefined}>{children}</div>
      <InboxBulkBar items={items} />
    </>
  );
}

type BulkKind = "done" | "archive" | "unarchive" | "pin";

export function InboxBulkBar({ items }: { items: InboxItem[] }) {
  const ui = useInboxRowUi();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!ui || !ui.selecting) return null;

  const { selected, patch, clear } = ui;
  const chosen = items.filter((item) => selected.includes(item.id));
  const allPinned = chosen.length > 0 && chosen.every((item) => item.pinnedAt);
  const allArchived = chosen.length > 0 && chosen.every((item) => itemIsArchived(item));
  const anyDone = chosen.some((item) => inboxCanMarkDone(item));

  async function run(kind: BulkKind) {
    setBusy(true);
    setError(null);
    const unpin = allPinned;
    for (const item of chosen) {
      if (kind === "pin" && unpin && !item.pinnedAt) continue;
      if (kind === "pin" && !unpin && item.pinnedAt) continue;
      if (kind === "done" && !inboxCanMarkDone(item)) continue;
      if (kind === "archive" && itemIsArchived(item)) continue;
      if (kind === "unarchive" && !itemIsArchived(item)) continue;
      const res =
        kind === "done"
          ? await inboxMarkDone(item)
          : kind === "archive"
            ? await inboxArchive(item)
            : kind === "unarchive"
              ? await inboxUnarchive(item)
              : await inboxTogglePin(item);
      if (res.error) {
        setError(res.error);
        setBusy(false);
        return;
      }
      if (kind === "archive" || kind === "unarchive") {
        patch(item.id, { hidden: true });
      }
    }
    if (kind === "done" || kind === "archive" || kind === "unarchive") clear();
    setBusy(false);
    router.refresh();
  }

  const errorLine = error ? (
    <p className="w-full text-xs text-warn" role="alert">
      {error}
    </p>
  ) : null;

  const fileKind = allArchived ? "unarchive" : "archive";

  return (
    <>
      <div className="sticky top-[var(--desk-header-h)] z-20 -mx-4 mt-0 flex min-h-12 items-center gap-1 border-b border-line bg-surface px-2 md:hidden">
        <button type="button" className={iconHit} disabled={busy} aria-label="Back" onClick={() => clear()}>
          <BackGlyph />
        </button>
        <p className="mr-auto min-w-8 text-sm font-medium tabular-nums text-ink">{chosen.length}</p>
        <button
          type="button"
          className={iconHit}
          disabled={busy}
          aria-label={allPinned ? "Unpin" : "Pin"}
          onClick={() => run("pin")}
        >
          {busy ? <span aria-hidden="true" className={pendingSpinnerInkClass} /> : <PinGlyph />}
        </button>
        <button
          type="button"
          className={iconHit}
          disabled={busy}
          aria-label={allArchived ? "Unarchive" : "Archive"}
          onClick={() => run(fileKind)}
        >
          {allArchived ? <UnarchiveGlyph /> : <ArchiveGlyph />}
        </button>
        {anyDone ? (
          <button type="button" className={btnDock} disabled={busy} aria-label="Mark done" onClick={() => run("done")}>
            {busy ? (
              <span aria-hidden="true" className={pendingSpinnerClass} />
            ) : (
              <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" aria-hidden="true">
                <path d="M3.2 8.2 6.4 11.4 12.8 4.6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
            )}
          </button>
        ) : null}
        {errorLine}
      </div>
      <div className="sticky top-[var(--desk-header-h)] z-20 mt-6 hidden min-h-11 flex-wrap items-center gap-2 border border-line bg-surface px-3 py-2 md:flex md:static md:rounded-xl">
        <p className="mr-auto text-sm font-medium text-ink">{chosen.length} selected</p>
        {anyDone ? (
          <button type="button" className={btnPrimary} disabled={busy} onClick={() => run("done")}>
            {busy ? "Saving" : "Mark done"}
          </button>
        ) : null}
        <button type="button" className={btnGhost} disabled={busy} onClick={() => run(fileKind)}>
          {allArchived ? "Unarchive" : "Archive"}
        </button>
        <button type="button" className={btnGhost} disabled={busy} onClick={() => run("pin")}>
          {allPinned ? "Unpin" : "Pin"}
        </button>
        <button type="button" className={btnGhost} disabled={busy} onClick={() => clear()}>
          Cancel
        </button>
        {errorLine}
      </div>
    </>
  );
}
