"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
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
  inboxSnooze,
  inboxTogglePin,
  inboxToggleRead,
} from "@/lib/inboxLeadActions";
import type { InboxItem } from "@/lib/inboxPurpose";

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

function MoreGlyph() {
  return (
    <svg viewBox="0 0 16 16" className="h-4 w-4" fill="currentColor" aria-hidden="true">
      <circle cx="8" cy="3.2" r="1.3" />
      <circle cx="8" cy="8" r="1.3" />
      <circle cx="8" cy="12.8" r="1.3" />
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

type BulkKind = "done" | "archive" | "pin" | "unread" | "snooze";

export function InboxBulkBar({ items }: { items: InboxItem[] }) {
  const ui = useInboxRowUi();
  const router = useRouter();
  const moreLabelId = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [more, setMore] = useState(false);
  if (!ui || !ui.selecting) return null;

  const { selected, patch, clear } = ui;
  const chosen = items.filter((item) => selected.includes(item.id));
  const allPinned = chosen.length > 0 && chosen.every((item) => item.pinnedAt);
  const allUnread = chosen.length > 0 && chosen.every((item) => item.unread);

  async function run(kind: BulkKind) {
    setBusy(true);
    setError(null);
    const unpin = allPinned;
    for (const item of chosen) {
      if (kind === "pin" && unpin && !item.pinnedAt) continue;
      if (kind === "pin" && !unpin && item.pinnedAt) continue;
      const res =
        kind === "done"
          ? await inboxMarkDone(item)
          : kind === "archive"
            ? await inboxArchive(item)
            : kind === "pin"
              ? await inboxTogglePin(item)
              : kind === "unread"
                ? await inboxToggleRead(item)
                : await inboxSnooze(item);
      if (res.error) {
        setError(res.error);
        setBusy(false);
        return;
      }
      if (kind === "done" || kind === "archive" || kind === "snooze") {
        patch(item.id, { hidden: true });
      }
    }
    if (kind === "done" || kind === "archive") clear();
    setMore(false);
    setBusy(false);
    router.refresh();
  }

  const errorLine = error ? (
    <p className="w-full text-xs text-warn" role="alert">
      {error}
    </p>
  ) : null;

  const moreSheet =
    more && typeof document !== "undefined"
      ? createPortal(
          <div
            className="fixed inset-x-0 bottom-[var(--desk-tabbar-h)] z-[60] flex h-[calc(100dvh-var(--desk-tabbar-h))] flex-col justify-end bg-ink/40 md:bottom-0 md:h-dvh"
            role="presentation"
            onClick={() => {
              if (!busy) setMore(false);
            }}
          >
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby={moreLabelId}
              className="flex h-auto max-h-[min(24rem,calc(100dvh-2rem))] w-full shrink-0 flex-col overflow-y-auto rounded-t-2xl border border-line bg-surface pb-[max(0.75rem,env(safe-area-inset-bottom,0px))] shadow-xl"
              onClick={(event) => event.stopPropagation()}
            >
              <p id={moreLabelId} className="px-4 pt-3 text-sm font-medium text-ink">
                {chosen.length} selected
              </p>
              {(
                [
                  { id: "unread" as const, label: allUnread ? "Mark read" : "Mark unread" },
                  { id: "snooze" as const, label: "Snooze" },
                ] as const
              ).map((action) => (
                <button
                  key={action.id}
                  type="button"
                  role="menuitem"
                  disabled={busy}
                  onClick={() => run(action.id)}
                  className={`flex min-h-11 w-full items-center px-4 text-left text-sm text-ink ${focusRingVisible} hover:bg-surface-muted disabled:opacity-50`}
                >
                  {busy ? "Saving" : action.label}
                </button>
              ))}
            </div>
          </div>,
          document.body
        )
      : null;

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
          aria-label="Archive"
          onClick={() => run("archive")}
        >
          <ArchiveGlyph />
        </button>
        <button type="button" className={btnDock} disabled={busy} aria-label="Mark done" onClick={() => run("done")}>
          {busy ? (
            <span aria-hidden="true" className={pendingSpinnerClass} />
          ) : (
            <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" aria-hidden="true">
              <path d="M3.2 8.2 6.4 11.4 12.8 4.6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          )}
        </button>
        <button
          type="button"
          className={iconHit}
          disabled={busy}
          aria-label="More"
          aria-haspopup="dialog"
          aria-expanded={more}
          onClick={() => setMore(true)}
        >
          <MoreGlyph />
        </button>
        {errorLine}
      </div>
      <div className="sticky top-[var(--desk-header-h)] z-20 mt-6 hidden min-h-11 flex-wrap items-center gap-2 border border-line bg-surface px-3 py-2 md:flex md:static md:rounded-xl">
        <p className="mr-auto text-sm font-medium text-ink">{chosen.length} selected</p>
        <button type="button" className={btnPrimary} disabled={busy} onClick={() => run("done")}>
          {busy ? "Saving" : "Mark done"}
        </button>
        <button type="button" className={btnGhost} disabled={busy} onClick={() => run("archive")}>
          Archive
        </button>
        <button type="button" className={btnGhost} disabled={busy} onClick={() => run("pin")}>
          {allPinned ? "Unpin" : "Pin"}
        </button>
        <button type="button" className={btnGhost} disabled={busy} onClick={() => clear()}>
          Cancel
        </button>
        {errorLine}
      </div>
      {moreSheet}
    </>
  );
}
