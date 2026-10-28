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
import { announceInboxResult, writeInboxArchiveUndo } from "@/lib/inboxArchiveUndo";
import { runOptimistic, serverActionError } from "@/lib/optimisticAction";
import { notify } from "@/components/ui/DeskNotice";
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

const INBOX_ROW_FAIL: Record<string, string> = {
  archive: "Could not archive.",
  unarchive: "Could not unarchive.",
  pin: "Could not pin.",
  unpin: "Could not unpin.",
  mark_done: "Could not mark done.",
};

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
  // Optimistic: the menu closes on tap, so nothing waits on a pending label.
  const pendingId: ActionId | null = null;
  const busyRef = useRef(false);
  const busy = false;

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
    if (busyRef.current) return;
    busyRef.current = true;
    setError(null);
    const view = inboxItemWithLocal(item, local);
    const before = { pinnedAt: local.pinnedAt, leadStatus: local.leadStatus };
    const leaves = id === "archive" || id === "unarchive";
    // Filled by the server call inside runOptimistic.
    const got: { archived: Awaited<ReturnType<typeof inboxArchive>> | null; text: string | null } = {
      archived: null,
      text: null,
    };

    // Screen first: the row leaves, pins or reads Done the moment it is tapped.
    // The server confirms in the background; on failure the row comes back
    // and a notice offers Try again.
    const out = await runOptimistic({
      apply: () => {
        if (leaves) patch({ hidden: true });
        if (id === "pin") patch({ pinnedAt: new Date().toISOString() });
        if (id === "unpin") patch({ pinnedAt: null });
        if (id === "mark_done") patch({ leadStatus: "resolved" });
        setOpen(false);
      },
      commit: async (): Promise<{ error?: string; ok?: boolean }> => {
        if (id === "pin" || id === "unpin") return inboxTogglePin(view);
        if (id === "mark_done") return inboxMarkDone(item);
        if (id === "archive") return (got.archived = await inboxArchive(item));
        if (id === "unarchive") {
          const one = await inboxUnarchive(item);
          got.text = "text" in one ? one.text : null;
          return one;
        }
        return { ok: true };
      },
      rollback: () => {
        if (leaves) patch({ hidden: false });
        if (id === "pin" || id === "unpin") patch({ pinnedAt: before.pinnedAt });
        if (id === "mark_done") patch({ leadStatus: before.leadStatus });
      },
      failed: serverActionError,
      fallback: INBOX_ROW_FAIL[id] ?? "Could not save.",
    });
    busyRef.current = false;
    if (!out.ok) {
      notify(out.error, {
        tone: "error",
        action: { label: "Try again", run: () => void run(id) },
      });
      return;
    }
    const archivedNow = got.archived;
    if (id === "archive" && item.callId && archivedNow?.archived !== false) {
      // Call plus its open requests (one transaction); Undo uses the record.
      writeInboxArchiveUndo([{ id: item.id, callId: item.callId }], undefined, undefined, {
        undoId: archivedNow?.undoId,
        holdIds: archivedNow?.holdIds,
        visitIds: archivedNow?.visitIds,
      });
    }
    const unarchivedText = got.text;
    if (id === "unarchive") announceInboxResult(unarchivedText);
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
