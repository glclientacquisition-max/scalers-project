"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  DESK_NOTICE_MS,
  deskNoticeClass,
  deskNoticeLeaveClass,
  deskNoticeOpenClass,
} from "@/lib/deskMotion";
import { usePrefersReducedMotion } from "@/components/ui/usePrefersReducedMotion";

const PLACE_CLASS =
  "pointer-events-none fixed inset-x-0 z-30 px-4 bottom-[calc(var(--desk-tabbar-h)+env(safe-area-inset-bottom,0px)+0.75rem)] md:bottom-6";

const NOTIFY_HOLD_MS = 4000;
/** Errors stay up longer: the owner has to read them and act. */
export const NOTIFY_ERROR_HOLD_MS = 8000;

type NoticeTone = "info" | "error";
type NoticeRecord = { id: string; message: string; tone: NoticeTone };

/** How long a notice stays on screen. */
export function noticeHoldMs(tone: NoticeTone | undefined): number {
  return tone === "error" ? NOTIFY_ERROR_HOLD_MS : NOTIFY_HOLD_MS;
}

let current: NoticeRecord | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

let seq = 0;

export function notify(message: string, options?: { tone?: NoticeTone }) {
  const text = message.trim();
  if (!text) return;
  seq += 1;
  current = { id: `${Date.now()}-${seq}`, message: text, tone: options?.tone ?? "info" };
  emit();
}

export function dismissNotice() {
  current = null;
  emit();
}

export function useNotify() {
  return { notify, dismiss: dismissNotice };
}

/**
 * Shift-family toast. Enter from below, exit the same way. Transform and
 * opacity only. Outer node is placement; inner node is the motion.
 */
export function DeskNotice({
  open,
  children,
}: {
  open: boolean;
  children: ReactNode;
}) {
  const reduced = usePrefersReducedMotion();
  const [present, setPresent] = useState(open);
  const [entered, setEntered] = useState(open && reduced);
  const [leaving, setLeaving] = useState(false);
  const presentRef = useRef(open);
  const held = useRef(children);
  if (open) held.current = children;

  useEffect(() => {
    if (open) {
      presentRef.current = true;
      setPresent(true);
      setLeaving(false);
      if (reduced) {
        setEntered(true);
        return;
      }
      setEntered(false);
      let inner = 0;
      const outer = window.requestAnimationFrame(() => {
        inner = window.requestAnimationFrame(() => setEntered(true));
      });
      return () => {
        window.cancelAnimationFrame(outer);
        window.cancelAnimationFrame(inner);
      };
    }
    if (!presentRef.current) return;
    if (reduced) {
      presentRef.current = false;
      setPresent(false);
      setEntered(false);
      setLeaving(false);
      return;
    }
    setLeaving(true);
    setEntered(false);
    const timer = window.setTimeout(() => {
      presentRef.current = false;
      setPresent(false);
      setLeaving(false);
    }, DESK_NOTICE_MS);
    return () => window.clearTimeout(timer);
  }, [open, reduced]);

  if (!present || typeof document === "undefined") return null;

  const phase = leaving
    ? deskNoticeLeaveClass
    : entered
      ? deskNoticeOpenClass
      : "";

  return createPortal(
    <div className={PLACE_CLASS} role="status" aria-live="polite" data-desk-notice="">
      <div className={`pointer-events-auto mx-auto w-full max-w-md ${deskNoticeClass} ${phase}`.trim()}>
        {held.current}
      </div>
    </div>,
    document.body
  );
}

export function NotifyHost() {
  const [notice, setNotice] = useState<NoticeRecord | null>(null);

  useEffect(() => {
    const sync = () => setNotice(current);
    sync();
    listeners.add(sync);
    return () => {
      listeners.delete(sync);
    };
  }, []);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => {
      if (current?.id === notice.id) dismissNotice();
    }, noticeHoldMs(notice.tone));
    return () => window.clearTimeout(timer);
  }, [notice]);

  return (
    <DeskNotice open={!!notice}>
      {notice ? (
        <div className="rounded-2xl border border-hairline bg-surface px-4 py-3 shadow-sheet">
          <p className={notice.tone === "error" ? "text-body text-warn" : "text-body text-ink"} role={notice.tone === "error" ? "alert" : undefined}>
            {notice.message}
          </p>
        </div>
      ) : null}
    </DeskNotice>
  );
}
