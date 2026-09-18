"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { useInboxRowUi } from "@/components/InboxRowUi";
import { DeskRowHit, deskRowActionClass, deskRowHitClass } from "@/components/ui/deskRowHit";
import { btnGhost, btnPrimary, focusRingVisible } from "@/components/ui/deskChrome";
import { inboxArchive, inboxDelete, inboxMarkDone } from "@/lib/inboxLeadActions";
import type { InboxItem } from "@/lib/inboxPurpose";

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
          ? ""
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

export function InboxBulkBar({ items }: { items: InboxItem[] }) {
  const ui = useInboxRowUi();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!ui || !ui.selecting) return null;

  const { selected, patch, clear } = ui;
  const chosen = items.filter((item) => selected.includes(item.id));

  async function run(kind: "done" | "archive" | "delete") {
    setBusy(true);
    setError(null);
    for (const item of chosen) {
      const res =
        kind === "done"
          ? await inboxMarkDone(item)
          : kind === "delete"
            ? await inboxDelete(item)
            : await inboxArchive(item);
      if (res.error) {
        setError(res.error);
        setBusy(false);
        return;
      }
      patch(item.id, { hidden: true });
    }
    clear();
    setBusy(false);
    router.refresh();
  }

  return (
    <div className="sticky top-[var(--desk-header-h)] z-20 mt-6 flex min-h-11 flex-wrap items-center gap-2 border border-line bg-surface px-3 py-2 md:static md:rounded-xl">
      <p className="mr-auto text-sm font-medium text-ink">{chosen.length} selected</p>
      <button type="button" className={btnPrimary} disabled={busy} onClick={() => run("done")}>
        {busy ? "Saving" : "Mark done"}
      </button>
      <button type="button" className={btnGhost} disabled={busy} onClick={() => run("archive")}>
        Archive
      </button>
      <button type="button" className={btnGhost} disabled={busy} onClick={() => run("delete")}>
        Archive
      </button>
      <button type="button" className={btnGhost} disabled={busy} onClick={() => clear()}>
        Cancel
      </button>
      {error ? (
        <p className="w-full text-xs text-warn" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
