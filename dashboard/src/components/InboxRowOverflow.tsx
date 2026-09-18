"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ElementType,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { DeskLandSurface } from "@/components/ui/DeskLand";
import { DeskDialog } from "@/components/ui/DeskDialog";
import { useInboxRowLocal, useInboxRowUi } from "@/components/InboxRowUi";
import {
  btnGhost,
  btnPrimary,
  deskFieldClass,
  deskHitClass,
  focusRingVisible,
} from "@/components/ui/deskChrome";
import { inboxArchive, inboxMarkDone } from "@/lib/inboxLeadActions";
import type { InboxItem } from "@/lib/inboxPurpose";

const LONG_PRESS_MS = 500;
const MOVE_CANCEL_PX = 12;

type MenuMode = "menu" | "sheet";
type DraftKind = "assign" | "label" | null;

const InboxRowMenuCtx = createContext<{
  openAt: (mode: MenuMode, x: number, y: number) => void;
  open: MenuMode | null;
} | null>(null);

export function useInboxRowMenu() {
  return useContext(InboxRowMenuCtx);
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

function isFinePointer() {
  return window.matchMedia("(hover: hover) and (pointer: fine)").matches;
}

function isInteractiveTarget(target: EventTarget | null, root: HTMLElement | null) {
  if (!(target instanceof Element) || !root) return false;
  const hit = target.closest("a, button, input, textarea, select");
  return Boolean(hit && root.contains(hit) && hit !== root);
}

type ActionId =
  | "select"
  | "unread"
  | "done"
  | "archive"
  | "mute"
  | "pin"
  | "assign"
  | "label"
  | "snooze"
  | "delete";

export function InboxRowShell({
  item,
  as,
  className,
  children,
}: {
  item: InboxItem;
  as: ElementType;
  className?: string;
  children: ReactNode;
}) {
  const [local, patch] = useInboxRowLocal(item.id);
  const ui = useInboxRowUi();
  const router = useRouter();
  const rootRef = useRef<HTMLElement | null>(null);
  const pressRef = useRef<{ timer: ReturnType<typeof setTimeout> | null; x: number; y: number }>({
    timer: null,
    x: 0,
    y: 0,
  });
  const [open, setOpen] = useState<MenuMode | null>(null);
  const [anchor, setAnchor] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [draft, setDraft] = useState<DraftKind>(null);
  const [draftValue, setDraftValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const close = useCallback(() => {
    if (busy) return;
    setOpen(null);
    setDraft(null);
  }, [busy]);

  const openAt = useCallback((mode: MenuMode, x: number, y: number) => {
    setError(null);
    setAnchor({ x, y });
    setOpen(mode);
  }, []);

  const clearPress = useCallback(() => {
    if (pressRef.current.timer) {
      clearTimeout(pressRef.current.timer);
      pressRef.current.timer = null;
    }
  }, []);

  useEffect(() => () => clearPress(), [clearPress]);

  const run = async (id: ActionId) => {
    if (id === "select") {
      ui?.enter(item.id);
      close();
      return;
    }
    if (id === "unread") {
      patch({ unread: !local.unread });
      close();
      return;
    }
    if (id === "mute") {
      patch({ muted: !local.muted });
      close();
      return;
    }
    if (id === "pin") {
      patch({ pinned: !local.pinned });
      close();
      return;
    }
    if (id === "snooze") {
      patch({ snoozed: true });
      close();
      return;
    }
    if (id === "delete") {
      patch({ hidden: true });
      close();
      return;
    }
    if (id === "assign" || id === "label") {
      setDraftValue(id === "assign" ? local.assignee || "" : "");
      setDraft(id);
      setOpen(null);
      return;
    }
    if (id === "done" || id === "archive") {
      if (!item.callId) {
        setError("Missing call.");
        return;
      }
      setBusy(true);
      setError(null);
      const res = id === "done" ? await inboxMarkDone(item) : await inboxArchive(item);
      setBusy(false);
      if (res.error) {
        setError(res.error);
        return;
      }
      close();
      router.refresh();
      return;
    }
  };

  const actions: { id: ActionId; label: string }[] = [
    { id: "select", label: "Select" },
    { id: "unread", label: local.unread ? "Mark read" : "Mark unread" },
    { id: "done", label: "Mark done" },
    { id: "archive", label: "Archive" },
    { id: "mute", label: local.muted ? "Unmute" : "Mute" },
    { id: "pin", label: local.pinned ? "Unpin" : "Pin" },
    { id: "assign", label: "Assign to teammate" },
    { id: "label", label: "Add label" },
    { id: "snooze", label: "Snooze" },
    { id: "delete", label: "Delete" },
  ];

  if (local.hidden || local.snoozed) return null;

  return (
    <InboxRowMenuCtx.Provider value={{ openAt, open }}>
      <DeskLandSurface
        as={as}
        id={item.id}
        className={[className, "group"].filter(Boolean).join(" ")}
        rowRef={rootRef}
        onContextMenu={(event: MouseEvent) => {
          event.preventDefault();
          if (ui?.selecting) return;
          openAt(isFinePointer() ? "menu" : "sheet", event.clientX, event.clientY);
        }}
        onPointerDown={(event: ReactPointerEvent) => {
          if (ui?.selecting) return;
          if (event.pointerType !== "touch") return;
          if (isInteractiveTarget(event.target, rootRef.current)) return;
          clearPress();
          pressRef.current.x = event.clientX;
          pressRef.current.y = event.clientY;
          pressRef.current.timer = setTimeout(() => {
            pressRef.current.timer = null;
            openAt("sheet", event.clientX, event.clientY);
          }, LONG_PRESS_MS);
        }}
        onPointerMove={(event: ReactPointerEvent) => {
          if (!pressRef.current.timer) return;
          const dx = event.clientX - pressRef.current.x;
          const dy = event.clientY - pressRef.current.y;
          if (dx * dx + dy * dy > MOVE_CANCEL_PX * MOVE_CANCEL_PX) clearPress();
        }}
        onPointerUp={clearPress}
        onPointerCancel={clearPress}
      >
        {children}
        {open ? (
          <InboxOverflowSurface
            item={item}
            mode={open}
            anchor={anchor}
            actions={actions}
            busy={busy}
            error={error}
            onRun={run}
            onClose={close}
          />
        ) : null}
        {draft ? (
          <DeskDialog
            title={draft === "assign" ? "Assign to teammate" : "Add label"}
            onClose={() => setDraft(null)}
          >
            <form
              className="mt-4 space-y-4"
              onSubmit={(event) => {
                event.preventDefault();
                const value = draftValue.trim();
                if (draft === "assign") patch({ assignee: value || null });
                else if (value) patch({ labels: [...local.labels, value] });
                setDraft(null);
                close();
              }}
            >
              <label className="block text-xs font-medium uppercase tracking-wide text-ink-soft">
                {draft === "assign" ? "Name" : "Label"}
                <input
                  value={draftValue}
                  onChange={(event) => setDraftValue(event.target.value)}
                  className={`${deskFieldClass} mt-1`}
                />
              </label>
              <div className="flex justify-end gap-2">
                <button type="button" className={btnGhost} onClick={() => setDraft(null)}>
                  Cancel
                </button>
                <button type="submit" className={btnPrimary}>
                  Save
                </button>
              </div>
            </form>
          </DeskDialog>
        ) : null}
      </DeskLandSurface>
    </InboxRowMenuCtx.Provider>
  );
}

export function InboxRowMore({ item }: { item: InboxItem }) {
  const menu = useInboxRowMenu();
  const ui = useInboxRowUi();
  const btnRef = useRef<HTMLButtonElement>(null);
  if (!menu || ui?.selecting) return null;
  return (
    <button
      ref={btnRef}
      type="button"
      aria-label={`More actions for ${item.callerName?.trim() || "Caller"}`}
      aria-haspopup="menu"
      aria-expanded={menu.open === "menu"}
      className={[
        deskHitClass,
        focusRingVisible,
        "hidden text-ink-soft hover:bg-surface-muted hover:text-ink [@media(hover:hover)_and_(pointer:fine)]:inline-flex",
        menu.open === "menu"
          ? "opacity-100"
          : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100",
      ].join(" ")}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        const rect = btnRef.current?.getBoundingClientRect();
        menu.openAt("menu", rect ? rect.right : event.clientX, rect ? rect.bottom : event.clientY);
      }}
    >
      <MoreGlyph />
    </button>
  );
}

function InboxOverflowSurface({
  item,
  mode,
  anchor,
  actions,
  busy,
  error,
  onRun,
  onClose,
}: {
  item: InboxItem;
  mode: MenuMode;
  anchor: { x: number; y: number };
  actions: { id: ActionId; label: string }[];
  busy: boolean;
  error: string | null;
  onRun: (id: ActionId) => void;
  onClose: () => void;
}) {
  const labelId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ y: number } | null>(null);
  const ignoreUntil = useRef(Date.now() + 450);
  const who = item.callerName?.trim() || "Caller";

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const items = panelRef.current?.querySelectorAll<HTMLElement>("[role='menuitem']");
    items?.[0]?.focus();

    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        if (!busy) onClose();
        return;
      }
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp" && event.key !== "Home" && event.key !== "End") {
        return;
      }
      const list = Array.from(panelRef.current?.querySelectorAll<HTMLElement>("[role='menuitem']") || []);
      if (!list.length) return;
      event.preventDefault();
      const i = list.indexOf(document.activeElement as HTMLElement);
      if (event.key === "Home") list[0].focus();
      else if (event.key === "End") list[list.length - 1].focus();
      else if (event.key === "ArrowDown") list[(i + 1 + list.length) % list.length].focus();
      else list[(i - 1 + list.length) % list.length].focus();
    }

    function onPointer(event: MouseEvent) {
      if (Date.now() < ignoreUntil.current) return;
      if (panelRef.current && !panelRef.current.contains(event.target as Node) && !busy) {
        onClose();
      }
    }

    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onPointer);
      previous?.focus?.();
    };
  }, [busy, onClose]);

  const menu = (
    <div
      ref={panelRef}
      role={mode === "sheet" ? "dialog" : "menu"}
      aria-modal={mode === "sheet" ? true : undefined}
      aria-labelledby={labelId}
      className={
        mode === "sheet"
          ? "flex max-h-[80vh] w-full flex-col overflow-y-auto rounded-t-2xl border border-line bg-surface pb-[max(0.5rem,env(safe-area-inset-bottom))] shadow-xl"
          : "z-50 min-w-[14rem] overflow-hidden rounded-xl border border-line bg-surface py-1 shadow-xl"
      }
      style={
        mode === "menu"
          ? {
              top: Math.min(anchor.y, typeof window !== "undefined" ? window.innerHeight - 320 : anchor.y),
              left: Math.min(anchor.x, typeof window !== "undefined" ? window.innerWidth - 240 : anchor.x),
              position: "fixed",
            }
          : undefined
      }
      onClick={(event) => event.stopPropagation()}
    >
      <p id={labelId} className={mode === "sheet" ? "px-4 pt-3 text-sm font-medium text-ink" : "sr-only"}>
        {who}
      </p>
      {mode === "sheet" ? (
        <button
          type="button"
          aria-label="Dismiss"
          className="mx-auto mt-1 min-h-11 w-full max-w-[4.5rem]"
          onPointerDown={(event) => {
            drag.current = { y: event.clientY };
          }}
          onPointerMove={(event) => {
            if (!drag.current) return;
            if (event.clientY - drag.current.y > 48 && !busy) onClose();
          }}
          onPointerUp={() => {
            drag.current = null;
          }}
        >
          <span className="mx-auto block h-1 w-10 rounded-full bg-line" />
        </button>
      ) : null}
      {actions.map((action) => (
        <button
          key={action.id}
          type="button"
          role="menuitem"
          disabled={busy}
          onClick={() => onRun(action.id)}
          className={[
            "flex w-full items-center px-4 text-left text-sm text-ink",
            mode === "sheet" ? "min-h-11" : "min-h-10",
            focusRingVisible,
            action.id === "delete" ? "text-ink-soft" : "",
            "hover:bg-surface-muted disabled:opacity-50",
          ].join(" ")}
        >
          {busy && (action.id === "done" || action.id === "archive") ? "Saving" : action.label}
        </button>
      ))}
      {error ? (
        <p className="px-4 py-2 text-xs text-warn" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );

  if (typeof document === "undefined") return null;

  if (mode === "sheet") {
    return createPortal(
      <div
        className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40"
        role="presentation"
        onClick={() => {
          if (Date.now() < ignoreUntil.current) return;
          if (!busy) onClose();
        }}
      >
        {menu}
      </div>,
      document.body
    );
  }

  return createPortal(menu, document.body);
}
