"use client";

import {
  createContext,
  Fragment,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ElementType,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { EllipsisVerticalIcon } from "@heroicons/react/24/outline";
import { DeskLandSurface } from "@/components/ui/DeskLand";
import { useInboxRowLocal, useInboxRowUi } from "@/components/InboxRowUi";
import { iconButtonClass } from "@/components/ui/IconButton";
import { Menu, MenuItem, MenuSeparator } from "@/components/ui/Menu";
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
  type InboxListActionId,
} from "@/lib/inboxListVerbs";
import type { InboxItem } from "@/lib/inboxPurpose";

const LONG_PRESS_MS = 400;
const PRESS_HINT_MS = 100;
const MOVE_CANCEL_PX = 12;

type ActionId = InboxListActionId;

const InboxRowMenuCtx = createContext<{
  open: boolean;
  setOpen: (open: boolean) => void;
  run: (id: ActionId) => void;
  busy: boolean;
  pendingId: ActionId | null;
  error: string | null;
} | null>(null);

export function useInboxRowMenu() {
  return useContext(InboxRowMenuCtx);
}

function isFinePointer() {
  return window.matchMedia("(hover: hover) and (pointer: fine)").matches;
}

/** Conversation link and row padding. Action controls stay out of this gesture. */
function isRowBodyPress(target: EventTarget | null, root: HTMLElement | null) {
  if (!(target instanceof Element) || !root || !root.contains(target)) return false;
  const interactive = target.closest("a, button, input, textarea, select, label");
  if (!interactive || interactive === root || !root.contains(interactive)) return true;
  return interactive.hasAttribute("data-inbox-row-body");
}

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
    hint: ReturnType<typeof setTimeout> | null;
    x: number;
    y: number;
    armed: boolean;
  }>({
    timer: null,
    hint: null,
    x: 0,
    y: 0,
    armed: false,
  });
  const [pressing, setPressing] = useState(false);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<ActionId | null>(null);
  const busyRef = useRef(false);
  const busy = pendingId !== null;

  const clearPress = useCallback(() => {
    if (pressRef.current.timer) {
      clearTimeout(pressRef.current.timer);
      pressRef.current.timer = null;
    }
    if (pressRef.current.hint) {
      clearTimeout(pressRef.current.hint);
      pressRef.current.hint = null;
    }
    setPressing(false);
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

  if (local.hidden) return null;

  return (
    <InboxRowMenuCtx.Provider value={{ open, setOpen, run, busy, pendingId, error }}>
      <DeskLandSurface
        as={as}
        id={item.id}
        className={[
          className,
          "group",
          ui?.selected.includes(item.id) ? "bg-accent/[0.06]" : "",
          pressing ? "opacity-80" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        data-pressing={pressing ? "true" : undefined}
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
            if (!isRowBodyPress(event.target, rootRef.current)) return;
            ui?.enter(item.id);
            return;
          }
          setError(null);
          setOpen(true);
        }}
        onPointerDown={(event: ReactPointerEvent) => {
          if (ui?.selecting) return;
          if (event.pointerType !== "touch") return;
          if (!isRowBodyPress(event.target, rootRef.current)) return;
          clearPress();
          pressRef.current.armed = false;
          pressRef.current.x = event.clientX;
          pressRef.current.y = event.clientY;
          pressRef.current.hint = setTimeout(() => {
            pressRef.current.hint = null;
            setPressing(true);
          }, PRESS_HINT_MS);
          pressRef.current.timer = setTimeout(() => {
            pressRef.current.timer = null;
            pressRef.current.armed = true;
            setPressing(false);
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
      </DeskLandSurface>
    </InboxRowMenuCtx.Provider>
  );
}

export function InboxRowMore({ item }: { item: InboxItem }) {
  const menu = useInboxRowMenu();
  const ui = useInboxRowUi();
  const [local] = useInboxRowLocal(item.id);
  const actions = inboxOverflowActions(inboxItemWithLocal(item, local));
  if (!menu || ui?.selecting || actions.length === 0) return null;

  return (
    <Menu
      open={menu.open}
      onOpenChange={(next) => {
        if (!next && menu.busy) return;
        menu.setOpen(next);
      }}
      trigger={
        <button
          type="button"
          aria-label={`More actions for ${item.callerName?.trim() || "Caller"}`}
          className={iconButtonClass({ size: "sm" })}
        >
          <EllipsisVerticalIcon aria-hidden="true" />
        </button>
      }
    >
      {actions.map((action) => (
        <Fragment key={action.id}>
          {action.divide ? <MenuSeparator /> : null}
          <MenuItem
            disabled={menu.busy}
            onClick={() => void menu.run(action.id)}
          >
            {menu.pendingId === action.id ? "Saving" : action.label}
          </MenuItem>
        </Fragment>
      ))}
      {menu.error ? (
        <p className="px-3 py-2 text-caption text-attention" role="alert">
          {menu.error}
        </p>
      ) : null}
    </Menu>
  );
}
