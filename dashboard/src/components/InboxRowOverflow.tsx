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
import { deskHitClass, focusRingVisible } from "@/components/ui/deskChrome";
import {
  inboxArchive,
  inboxUnarchive,
} from "@/lib/inboxLeadActions";
import {
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

type MenuMode = "menu" | "sheet";

const InboxRowMenuCtx = createContext<{
  openAt: (mode: MenuMode, anchor: InboxOverflowAnchor) => void;
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
  const [open, setOpen] = useState<MenuMode | null>(null);
  const [anchor, setAnchor] = useState<InboxOverflowAnchor>({ x: 0, y: 0, align: "point" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const close = useCallback(() => {
    if (busy) return;
    setOpen(null);
  }, [busy]);

  const openAt = useCallback((mode: MenuMode, next: InboxOverflowAnchor) => {
    setError(null);
    setAnchor(next);
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
    if (!item.callId) {
      setError("Missing call.");
      return;
    }
    setBusy(true);
    setError(null);
    let res: { error?: string; ok?: boolean } = { ok: true };
    if (id === "archive") res = await inboxArchive(item);
    if (id === "unarchive") res = await inboxUnarchive(item);
    setBusy(false);
    if (res.error) {
      setError(res.error);
      return;
    }
    if (id === "archive" || id === "unarchive") {
      patch({ hidden: true });
    }
    close();
    router.refresh();
  };

  const actions: OverflowAction[] = inboxOverflowActions(item);

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
          openAt("menu", {
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
            mode={open}
            anchor={anchor}
            actions={actions}
            busy={busy}
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
  const btnRef = useRef<HTMLButtonElement>(null);
  const actions = inboxOverflowActions(item);
  if (!menu || ui?.selecting || actions.length === 0) return null;
  return (
    <button
      ref={btnRef}
      type="button"
      aria-label={`More actions for ${item.callerName?.trim() || "Caller"}`}
      aria-haspopup="menu"
      aria-expanded={menu.open === "menu" || menu.open === "sheet"}
      className={[
        deskHitClass,
        focusRingVisible,
        "inline-flex text-ink-soft hover:bg-surface-muted hover:text-ink",
        menu.open
          ? "opacity-100"
          : "md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100 md:focus-visible:opacity-100",
      ].join(" ")}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        const rect = btnRef.current?.getBoundingClientRect();
        const coarse = !isFinePointer();
        menu.openAt(
          coarse ? "sheet" : "menu",
          rect
            ? { x: rect.left, y: rect.top, w: rect.width, h: rect.height, align: "end" }
            : { x: event.clientX, y: event.clientY, align: "point" }
        );
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
  anchor: InboxOverflowAnchor;
  actions: OverflowAction[];
  busy: boolean;
  error: string | null;
  onRun: (id: ActionId) => void;
  onClose: () => void;
}) {
  const labelId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ y: number } | null>(null);
  const ignoreUntil = useRef(Date.now() + 450);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const who = item.callerName?.trim() || "Caller";

  useLayoutEffect(() => {
    if (mode !== "menu") return;
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
  }, [mode, anchor, error, actions.length]);

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
          ? "flex h-auto max-h-[min(24rem,calc(100dvh-2rem))] w-full shrink-0 flex-col overflow-y-auto rounded-t-2xl border border-line bg-surface pb-[max(0.75rem,env(safe-area-inset-bottom,0px))] shadow-xl"
          : "z-50 max-h-[min(24rem,calc(100dvh-1rem))] min-w-[14rem] overflow-y-auto rounded-xl border border-line bg-surface py-1 shadow-xl"
      }
      style={
        mode === "menu"
          ? {
              position: "fixed",
              top: pos?.top ?? 0,
              left: pos?.left ?? 0,
              visibility: pos ? "visible" : "hidden",
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
        <Fragment key={action.id}>
          {action.divide ? <div role="separator" className="my-1 border-t border-line" /> : null}
          <button
            type="button"
            role="menuitem"
            disabled={busy}
            onClick={() => onRun(action.id)}
            className={[
              "flex w-full items-center px-4 text-left text-sm text-ink",
              mode === "sheet" ? "min-h-11" : "min-h-10",
              focusRingVisible,
              "hover:bg-surface-muted disabled:opacity-50",
            ].join(" ")}
          >
            {busy ? "Saving" : action.label}
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

  if (mode === "sheet") {
    return createPortal(
      <div
        className="fixed inset-x-0 bottom-0 z-50 flex h-dvh flex-col justify-end bg-ink/40"
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
