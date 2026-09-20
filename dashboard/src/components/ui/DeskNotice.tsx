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
  "fixed inset-x-0 z-30 flex justify-center px-4 bottom-[calc(var(--desk-tabbar-h)+env(safe-area-inset-bottom,0px)+0.75rem)] md:bottom-6";

const NOTIFY_HOLD_MS = 4000;

type NoticeRecord = { id: string; message: string };

let current: NoticeRecord | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

export function notify(message: string) {
  const text = message.trim();
  if (!text) return;
  current = { id: `${Date.now()}-${text}`, message: text };
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
      <div className={`w-full max-w-md ${deskNoticeClass} ${phase}`.trim()}>
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
    }, NOTIFY_HOLD_MS);
    return () => window.clearTimeout(timer);
  }, [notice]);

  return (
    <DeskNotice open={!!notice}>
      {notice ? (
        <div className="rounded-xl border border-line bg-surface px-3 py-3 shadow-xl">
          <p className="text-sm text-ink">{notice.message}</p>
        </div>
      ) : null}
    </DeskNotice>
  );
}
