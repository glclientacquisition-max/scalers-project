"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { CallFaqSuggestions } from "@/components/CallFaqSuggestions";
import { CallRecording } from "@/components/CallRecording";
import { CallTranscript } from "@/components/CallTranscript";
import { InboxHoldEditor } from "@/components/InboxHoldEditor";
import { InboxJobActions } from "@/components/InboxJobActions";
import { InboxJobEditor } from "@/components/InboxJobEditor";
import { InboxPurposeChip } from "@/components/InboxPurposeChip";
import { InboxSmsDock } from "@/components/InboxSmsDock";
import { RequestStatusToggle } from "@/components/RequestStatusToggle";
import { CallLink } from "@/components/CallLink";
import { WhatsAppLink } from "@/components/WhatsAppLink";
import { DeskBack } from "@/components/ui/DeskBack";
import { RowIdentity } from "@/components/ui/deskRow";
import {
  deskHitClass,
  deskShiftClass,
  focusRingVisible,
} from "@/components/ui/deskChrome";
import { updateLeadStatus } from "@/app/(desk)/calls/actions";
import type { InboxHold, InboxJob } from "@/lib/inboxPurpose";
import type { TranscriptRow } from "@/lib/supabase";

function MoreGlyph() {
  return (
    <svg viewBox="0 0 16 16" className="h-4 w-4" fill="currentColor" aria-hidden="true">
      <circle cx="8" cy="3.2" r="1.3" />
      <circle cx="8" cy="8" r="1.3" />
      <circle cx="8" cy="12.8" r="1.3" />
    </svg>
  );
}

function SystemNotice({ children }: { children: ReactNode }) {
  const text = typeof children === "string" ? children.trim() : children;
  if (!text) return null;
  return (
    <div className="flex justify-center px-2">
      <p className="max-w-[85%] rounded-full bg-surface-muted/80 px-4 py-1.5 text-center text-xs text-ink-soft [overflow-wrap:anywhere]">
        {text}
      </p>
    </div>
  );
}

function InboxTicketMore({ callId }: { callId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sheet, setSheet] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const ignoreUntil = useRef(0);

  function placeMenu() {
    const phone = window.matchMedia("(max-width: 767px)").matches;
    const coarse = !window.matchMedia("(hover: hover) and (pointer: fine)").matches;
    setSheet(phone || coarse);
    const rect = btnRef.current?.getBoundingClientRect();
    if (rect) {
      setPos({
        top: rect.bottom + 4,
        left: Math.max(8, rect.right - 160),
      });
    }
  }

  const menu = (
    <div
      role={sheet ? "dialog" : "menu"}
      className={
        sheet
          ? "flex w-full flex-col rounded-t-2xl border border-line bg-surface pb-[max(0.75rem,env(safe-area-inset-bottom,0px))] shadow-xl"
          : "min-w-[10rem] rounded-xl border border-line bg-surface py-1 shadow-xl"
      }
      style={
        sheet || !pos
          ? undefined
          : { position: "fixed", top: pos.top, left: pos.left, zIndex: 50 }
      }
    >
      <button
        type="button"
        role="menuitem"
        disabled={busy}
        className={`flex min-h-11 w-full items-center px-4 text-left text-sm text-ink ${focusRingVisible} hover:bg-surface-muted disabled:opacity-50`}
        onClick={async () => {
          setBusy(true);
          const res = await updateLeadStatus(callId, "archived");
          setBusy(false);
          if (res.error) {
            setError(res.error);
            return;
          }
          setOpen(false);
          router.push("/calls");
          router.refresh();
        }}
      >
        {busy ? "Saving" : "Archive"}
      </button>
      {error ? (
        <p className="px-4 py-2 text-xs text-warn" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );

  return (
    <div className="relative">
      <button
        ref={btnRef}
        type="button"
        aria-label="More"
        aria-haspopup="menu"
        aria-expanded={open}
        className={`${deskHitClass} ${focusRingVisible} text-ink-soft hover:bg-surface-muted hover:text-ink`}
        onClick={() => {
          setError(null);
          if (!open) {
            ignoreUntil.current = Date.now() + 450;
            placeMenu();
          }
          setOpen((next) => !next);
        }}
      >
        <MoreGlyph />
      </button>
      {open && typeof document !== "undefined"
        ? createPortal(
            sheet ? (
              <div
                className="fixed inset-0 z-50 flex flex-col justify-end bg-ink/40"
                role="presentation"
                onClick={() => {
                  if (Date.now() < ignoreUntil.current) return;
                  if (!busy) setOpen(false);
                }}
              >
                <div onClick={(event) => event.stopPropagation()}>{menu}</div>
              </div>
            ) : (
              <>
                <button
                  type="button"
                  aria-label="Dismiss"
                  className="fixed inset-0 z-40"
                  onClick={() => {
                    if (Date.now() < ignoreUntil.current) return;
                    if (!busy) setOpen(false);
                  }}
                />
                {menu}
              </>
            ),
            document.body
          )
        : null}
    </div>
  );
}

export function InboxTicketView({
  callId,
  backHref,
  contactHref,
  title,
  stamp,
  purpose,
  callerPhone,
  waMessage,
  needsYou,
  urgency,
  want,
  done,
  mood,
  job,
  hold,
  turns,
  tenantId,
  recordingUrl,
  durationLabel,
  assistLabel,
  assistNote,
  escalatedLine,
  archived,
}: {
  callId: string;
  backHref: string;
  contactHref: string | null;
  title: string;
  stamp: string;
  purpose: "live" | "job" | "hold" | "human" | "missed" | "answered";
  callerPhone: string | null;
  waMessage: string;
  needsYou: boolean;
  urgency: string | null;
  want: string | null;
  done: string | null;
  mood: string | null;
  job: InboxJob | null;
  hold: InboxHold | null;
  turns: TranscriptRow[];
  tenantId: string;
  recordingUrl: string | null;
  durationLabel: string;
  assistLabel: string | null;
  assistNote: string | null;
  escalatedLine: string | null;
  archived: boolean;
}) {
  const threadRef = useRef<HTMLDivElement>(null);
  const [away, setAway] = useState(false);
  const canConfirm = String(job?.status || "").toLowerCase() === "requested";
  const canHoldDone = String(hold?.status || "").toLowerCase() === "open";
  const identity = (
    <>
      <RowIdentity name={title} />
      <span className="min-w-0">
        <span className="block truncate text-sm font-semibold text-ink">{title}</span>
        <InboxPurposeChip purpose={purpose} label={stamp} />
      </span>
    </>
  );

  function measure() {
    const el = threadRef.current;
    if (!el) return;
    setAway(el.scrollHeight - el.scrollTop - el.clientHeight > 96);
  }

  function jumpLatest() {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight, behavior: "smooth" });
  }

  useEffect(() => {
    const el = threadRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    measure();
  }, [turns.length]);

  return (
    <div className="-mx-4 -mb-[var(--desk-tabbar-clearance)] -mt-6 flex h-[calc(100dvh-var(--desk-header-h))] min-h-0 flex-col pb-[calc(var(--desk-tabbar-h)+env(safe-area-inset-bottom,0px))] sm:-mx-6 sm:-mt-10 md:mb-0 md:pb-0">
      <header className="shrink-0 border-b border-line bg-surface px-4 pt-3 pb-3 sm:px-6">
        <DeskBack href={backHref}>Inbox</DeskBack>
        <div className="mt-2 flex items-center gap-2">
          {contactHref ? (
            <Link
              href={contactHref}
              className={`flex min-h-11 min-w-0 flex-1 items-center gap-3 rounded-xl ${deskShiftClass} focus:outline-none focus:ring-2 focus:ring-[#0096FF]`}
            >
              {identity}
            </Link>
          ) : (
            <div className="flex min-h-11 min-w-0 flex-1 items-center gap-3">{identity}</div>
          )}
          {callerPhone ? <CallLink number={callerPhone} /> : null}
          {callerPhone ? (
            <WhatsAppLink number={callerPhone} message={waMessage} variant="icon" />
          ) : null}
          {archived ? null : <InboxTicketMore callId={callId} />}
        </div>
      </header>

      {needsYou && urgency ? (
        <p className="shrink-0 border-b border-warn/40 bg-warn-soft px-4 py-2 text-sm font-medium text-warn sm:px-6">
          {urgency}
        </p>
      ) : null}

      <div className="relative min-h-0 flex-1">
        <div
          ref={threadRef}
          onScroll={measure}
          className="absolute inset-0 space-y-2.5 overflow-y-auto px-4 py-4 sm:px-6"
        >
          {want ? <SystemNotice>{`Want. ${want}`}</SystemNotice> : null}
          {mood ? <SystemNotice>{`Mood. ${mood}`}</SystemNotice> : null}
          {done ? <SystemNotice>{`Done. ${done}`}</SystemNotice> : null}
          <CallTranscript turns={turns} mode="thread" />
          {job ? (
            <div className="mx-auto max-w-lg rounded-2xl bg-surface-muted/60 px-4 py-3">
              <InboxJobEditor id={job.id} whenText={job.when_text} landmark={job.address_landmark} />
            </div>
          ) : null}
          {hold ? (
            <div className="mx-auto max-w-lg rounded-2xl bg-surface-muted/60 px-4 py-3">
              <InboxHoldEditor id={hold.id} whenText={hold.when_text} />
            </div>
          ) : null}
          <CallFaqSuggestions
            tenantId={tenantId}
            callId={callId}
            hasTranscript={turns.length > 0}
            tone="thread"
          />
          <div className="mx-auto max-w-lg space-y-2 pt-4 text-center text-xs text-ink-soft">
            <p>Duration: {durationLabel}</p>
            {assistLabel ? <p>Assist: {assistLabel}</p> : null}
            {assistNote ? <p className="[overflow-wrap:anywhere]">{assistNote}</p> : null}
            {escalatedLine ? <p className="[overflow-wrap:anywhere]">{escalatedLine}</p> : null}
            <CallRecording recordingUrl={recordingUrl} />
          </div>
        </div>
        {away ? (
          <button
            type="button"
            onClick={jumpLatest}
            className={`absolute bottom-3 right-4 z-10 inline-flex h-12 min-w-12 items-center justify-center rounded-full bg-[#005CCC] px-4 text-sm font-semibold text-white shadow-lg ${deskShiftClass} focus:outline-none focus:ring-2 focus:ring-[#0096FF]`}
          >
            Jump to latest
          </button>
        ) : null}
      </div>

      {canConfirm && job ? (
        <div className="shrink-0 border-t border-line bg-surface px-4 py-3 sm:px-6">
          <InboxJobActions id={job.id} status={job.status} banner />
        </div>
      ) : canHoldDone && hold ? (
        <div className="shrink-0 border-t border-line bg-surface px-4 py-3 sm:px-6">
          <RequestStatusToggle id={hold.id} status={hold.status} banner />
        </div>
      ) : null}

      {needsYou && !archived ? (
        <InboxSmsDock callId={callId} callerPhone={callerPhone} />
      ) : null}
    </div>
  );
}
