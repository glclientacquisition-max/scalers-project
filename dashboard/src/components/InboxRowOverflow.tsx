"use client";

import {
  createContext,
  Fragment,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ElementType,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { DeskLandSurface } from "@/components/ui/DeskLand";
import { useInboxRowLocal, useInboxRowUi } from "@/components/InboxRowUi";
import { DeskHint } from "@/components/ui/DeskHint";
import { deskHitClass, focusRingVisible } from "@/components/ui/deskChrome";
import {
  inboxArchive,
  inboxMarkDone,
  inboxTogglePin,
  inboxUnarchive,
} from "@/lib/inboxLeadActions";
import { writeInboxArchiveUndo } from "@/lib/inboxArchiveUndo";
import {
  inboxItemWithLocal,
  inboxOverflowActions,
  type InboxListAction,
  type InboxListActionId,
} from "@/lib/inboxListVerbs";
import {
  placeInboxOverflowMenu,
  type InboxOverflowAnchor,
} from "@/lib/inboxOverflowPlace";
import type { InboxItem } from "@/lib/inboxPurpose";

const LONG_PRESS_MS = 500;
const MOVE_CANCEL_PX = 12;

const InboxRowMenuCtx = createContext<{
  openAt: (anchor: InboxOverflowAnchor) => void;
  open: boolean;
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

type ActionId = InboxListActionId;
type OverflowAction = InboxListAction;

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
  const pressRef = useRef<{
    timer: ReturnType<typeof setTimeout> | null;
    x: number;
    y: number;
    armed: boolean;
  }>({
    timer: null,
    x: 0,
    y: 0,
    armed: false,
  });
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<InboxOverflowAnchor>({ x: 0, y: 0, align: "point" });
  const [error, setError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<ActionId | null>(null);
  const busyRef = useRef(false);
  const busy = pendingId !== null;

  const close = useCallback(() => {
    if (busyRef.current) return;
    setOpen(false);
  }, []);

  const openAt = useCallback((next: InboxOverflowAnchor) => {
    setError(null);
    setAnchor(next);
    setOpen(true);
  }, []);

  const clearPress = useCallback(() => {
    if (pressRef.current.timer) {
      clearTimeout(pressRef.current.timer);
      pressRef.current.timer = null;
    }
  }, []);

  useEffect(() => () => clearPress(), [clearPress]);

  const run = async (id: ActionId) => {
    if (!item.callId) {
      setError("Missing call.");
      return;
    }
    busyRef.current = true;
    setPendingId(id);
    setError(null);
    const view = inboxItemWithLocal(item, local);
    let res: { error?: string; ok?: boolean } = { ok: true };
    if (id === "pin" || id === "unpin") res = await inboxTogglePin(view);
    if (id === "mark_done") res = await inboxMarkDone(item);
    if (id === "archive") res = await inboxArchive(item);
    if (id === "unarchive") res = await inboxUnarchive(item);
    busyRef.current = false;
    setPendingId(null);
    if (res.error) {
      setError(res.error);
      return;
    }
    if (id === "archive" && item.callId) {
      writeInboxArchiveUndo([{ id: item.id, callId: item.callId }]);
    }
    if (id === "archive" || id === "unarchive") {
      patch({ hidden: true });
    }
    if (id === "pin") patch({ pinnedAt: new Date().toISOString() });
    if (id === "unpin") patch({ pinnedAt: null });
    setOpen(false);
    router.refresh();
  };

  const actions: OverflowAction[] = inboxOverflowActions(inboxItemWithLocal(item, local));

  if (local.hidden) return null;

  return (
    <InboxRowMenuCtx.Provider value={{ openAt, open }}>
      <DeskLandSurface
        as={as}
        id={item.id}
        className={[
          className,
          "group",
          ui?.selected.includes(item.id) ? "bg-accent/[0.06]" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        rowRef={rootRef}
        onClickCapture={(event: MouseEvent) => {
          if (!pressRef.current.armed) return;
          event.preventDefault();
          event.stopPropagation();
          pressRef.current.armed = false;
        }}
        onContextMenu={(event: MouseEvent) => {
          event.preventDefault();
          if (ui?.selecting) return;
          if (!isFinePointer()) {
            ui?.enter(item.id);
            return;
          }
          openAt({
            x: event.clientX,
            y: event.clientY,
            align: "point",
          });
        }}
        onPointerDown={(event: ReactPointerEvent) => {
          if (ui?.selecting) return;
          if (event.pointerType !== "touch") return;
          if (isInteractiveTarget(event.target, rootRef.current)) return;
          clearPress();
          pressRef.current.armed = false;
          pressRef.current.x = event.clientX;
          pressRef.current.y = event.clientY;
          pressRef.current.timer = setTimeout(() => {
            pressRef.current.timer = null;
            pressRef.current.armed = true;
            ui?.enter(item.id);
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
            anchor={anchor}
            actions={actions}
            busy={busy}
            pendingId={pendingId}
            error={error}
            onRun={run}
            onClose={close}
          />
        ) : null}
      </DeskLandSurface>
    </InboxRowMenuCtx.Provider>
  );
}

export function InboxRowMore({ item }: { item: InboxItem }) {
  const menu = useInboxRowMenu();
  const ui = useInboxRowUi();
  const [local] = useInboxRowLocal(item.id);
  const btnRef = useRef<HTMLButtonElement>(null);
  const actions = inboxOverflowActions(inboxItemWithLocal(item, local));
  if (!menu || ui?.selecting || actions.length === 0) return null;
  return (
    <DeskHint label="More" side="top">
      <button
        ref={btnRef}
        type="button"
        aria-label={`More actions for ${item.callerName?.trim() || "Caller"}`}
        aria-haspopup="menu"
        aria-expanded={menu.open}
        className={[
          deskHitClass,
          focusRingVisible,
          "hidden md:inline-flex text-ink-soft hover:bg-surface-muted hover:text-ink",
          menu.open
            ? "opacity-100"
            : "md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100 md:focus-visible:opacity-100",
        ].join(" ")}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          const rect = btnRef.current?.getBoundingClientRect();
          menu.openAt(
            rect
              ? { x: rect.left, y: rect.top, w: rect.width, h: rect.height, align: "end" }
              : { x: event.clientX, y: event.clientY, align: "point" }
          );
        }}
      >
        <MoreGlyph />
      </button>
    </DeskHint>
  );
}

function InboxOverflowSurface({
  item,
  anchor,
  actions,
  busy,
  pendingId,
  error,
  onRun,
  onClose,
}: {
  item: InboxItem;
  anchor: InboxOverflowAnchor;
  actions: OverflowAction[];
  busy: boolean;
  pendingId: ActionId | null;
  error: string | null;
  onRun: (id: ActionId) => void;
  onClose: () => void;
}) {
  const labelId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const ignoreUntil = useRef(Date.now() + 450);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const who = item.callerName?.trim() || "Caller";

  useLayoutEffect(() => {
    function place() {
      const el = panelRef.current;
      if (!el) return;
      const view = window.visualViewport;
      setPos(
        placeInboxOverflowMenu(
          { width: el.offsetWidth, height: el.offsetHeight },
          anchor,
          {
            width: view?.width ?? window.innerWidth,
            height: view?.height ?? window.innerHeight,
          }
        )
      );
    }
    place();
    window.addEventListener("resize", place);
    window.visualViewport?.addEventListener("resize", place);
    return () => {
      window.removeEventListener("resize", place);
      window.visualViewport?.removeEventListener("resize", place);
    };
  }, [anchor, error, actions.length]);

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
      role="menu"
      aria-labelledby={labelId}
      className="z-[60] max-h-[min(24rem,calc(100dvh-1rem))] min-w-[14rem] overflow-y-auto rounded-xl border border-line bg-surface py-1 shadow-xl"
      style={{
        position: "fixed",
        top: pos?.top ?? 0,
        left: pos?.left ?? 0,
        visibility: pos ? "visible" : "hidden",
      }}
      onClick={(event) => event.stopPropagation()}
    >
      <p id={labelId} className="sr-only">
        {who}
      </p>
      {actions.map((action) => (
        <Fragment key={action.id}>
          {action.divide ? <div role="separator" className="my-1 border-t border-line" /> : null}
          <button
            type="button"
            role="menuitem"
            disabled={busy}
            onClick={() => onRun(action.id)}
            className={[
              "flex w-full items-center px-4 text-left text-sm text-ink",
              "min-h-11",
              focusRingVisible,
              "hover:bg-surface-muted disabled:opacity-50",
            ].join(" ")}
          >
            {pendingId === action.id ? "Saving" : action.label}
          </button>
        </Fragment>
      ))}
      {error ? (
        <p className="px-4 py-2 text-xs text-warn" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );

  if (typeof document === "undefined") return null;

  return createPortal(<div className="desk-theme">{menu}</div>, document.body);
}
