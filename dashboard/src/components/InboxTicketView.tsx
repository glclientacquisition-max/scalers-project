"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
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
  metaLabelClass,
} from "@/components/ui/deskChrome";
import { updateLeadStatus } from "@/app/(desk)/calls/actions";
import type { InboxHold, InboxJob } from "@/lib/inboxPurpose";
import type { TranscriptRow } from "@/lib/supabase";

function JumpGlyph() {
  return (
    <svg viewBox="0 0 16 16" className="h-5 w-5" fill="none" aria-hidden="true">
      <path
        d="M4 6.5 8 10.5 12 6.5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
  return (
    <svg viewBox="0 0 16 16" className="h-4 w-4" fill="currentColor" aria-hidden="true">
      <circle cx="8" cy="3.2" r="1.3" />
      <circle cx="8" cy="8" r="1.3" />
      <circle cx="8" cy="12.8" r="1.3" />
    </svg>
  );
}

function TicketSummaryFacts({
  want,
  mood,
  done,
}: {
  want: string | null;
  mood: string | null;
  done: string | null;
}) {
  if (!want && !mood && !done) return null;
  return (
    <dl className="space-y-3 rounded-2xl bg-accent-soft/70 px-4 py-3">
      {want ? (
        <div>
          <dt className={metaLabelClass}>Want</dt>
          <dd className="mt-1 text-sm text-ink [overflow-wrap:anywhere]">{want}</dd>
        </div>
      ) : null}
      {mood ? (
        <div>
          <dt className={metaLabelClass}>Mood</dt>
          <dd className="mt-1 text-sm text-ink">{mood}</dd>
        </div>
      ) : null}
      {done ? (
        <div>
          <dt className={metaLabelClass}>Done</dt>
          <dd className="mt-1 text-sm text-ink [overflow-wrap:anywhere]">{done}</dd>
        </div>
      ) : null}
    </dl>
  );
}

function InboxTicketMore({ callId, backHref }: { callId: string; backHref: string }) {
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
          router.push(backHref);
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
  const paneRef = useRef<HTMLDivElement>(null);
  const threadRef = useRef<HTMLDivElement>(null);
  const [away, setAway] = useState(false);
  const canConfirm = String(job?.status || "").toLowerCase() === "requested";
  const canHoldDone = String(hold?.status || "").toLowerCase() === "open";
  const dockedAction = canConfirm || canHoldDone || (needsYou && !archived);
  const identity = (
    <>
      <RowIdentity name={title} />
      <span className="min-w-0">
        <span className="block truncate text-sm font-semibold text-ink">{title}</span>
        <InboxPurposeChip purpose={purpose} label={stamp} />
      </span>
    </>
  );

  function scroller() {
    if (typeof window !== "undefined" && window.matchMedia("(min-width: 1024px)").matches) {
      return threadRef.current;
    }
    return paneRef.current;
  }

  function measure() {
    const el = scroller();
    if (!el) return;
    setAway(el.scrollHeight - el.scrollTop - el.clientHeight > 96);
  }

  function jumpLatest() {
    scroller()?.scrollTo({ top: scroller()!.scrollHeight, behavior: "smooth" });
  }

  useEffect(() => {
    function bind() {
      const el = scroller();
      if (!el) return () => {};
      el.scrollTop = el.scrollHeight;
      measure();
      el.addEventListener("scroll", measure);
      return () => el.removeEventListener("scroll", measure);
    }
    let unbind = bind();
    const mq = window.matchMedia("(min-width: 1024px)");
    const onChange = () => {
      unbind();
      unbind = bind();
    };
    mq.addEventListener("change", onChange);
    window.addEventListener("resize", measure);
    return () => {
      unbind();
      mq.removeEventListener("change", onChange);
      window.removeEventListener("resize", measure);
    };
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
          {archived ? null : <InboxTicketMore callId={callId} backHref={backHref} />}
        </div>
      </header>

      {needsYou && urgency ? (
        <p className="shrink-0 border-b border-warn/40 bg-warn-soft px-4 py-2 text-sm font-medium text-warn sm:px-6">
          {urgency}
        </p>
      ) : null}

      <div
        data-ticket-split=""
        className="relative min-h-0 flex-1 lg:grid lg:grid-cols-[minmax(18rem,22rem)_minmax(0,1fr)] lg:grid-rows-[minmax(0,1fr)]"
      >
        <div
          ref={paneRef}
          className="absolute inset-0 overflow-y-auto lg:contents"
        >
          <aside
            data-ticket-summary=""
            className="space-y-4 px-4 py-4 sm:px-6 lg:min-h-0 lg:overflow-y-auto lg:border-r lg:border-line"
          >
            <TicketSummaryFacts want={want} mood={mood} done={done} />
            {job ? (
              <div className="rounded-2xl bg-surface-muted/60 px-4 py-3">
                <InboxJobEditor id={job.id} whenText={job.when_text} landmark={job.address_landmark} />
              </div>
            ) : null}
            {hold ? (
              <div className="rounded-2xl bg-surface-muted/60 px-4 py-3">
                <InboxHoldEditor id={hold.id} whenText={hold.when_text} />
              </div>
            ) : null}
            <div className="space-y-2 text-xs text-ink-soft">
              <p>Duration: {durationLabel}</p>
              {assistLabel ? <p>Assist: {assistLabel}</p> : null}
              {assistNote ? <p className="[overflow-wrap:anywhere]">{assistNote}</p> : null}
              {escalatedLine ? <p className="[overflow-wrap:anywhere]">{escalatedLine}</p> : null}
              <CallRecording recordingUrl={recordingUrl} />
            </div>
          </aside>
          <section data-ticket-thread="" className="relative min-h-0">
            <div
              ref={threadRef}
              className="space-y-2.5 px-4 py-4 sm:px-6 lg:absolute lg:inset-0 lg:overflow-y-auto"
            >
              <CallTranscript turns={turns} mode="thread" />
              <CallFaqSuggestions
                tenantId={tenantId}
                callId={callId}
                hasTranscript={turns.length > 0}
                tone="thread"
              />
            </div>
          </section>
        </div>
        {away ? (
          <button
            type="button"
            onClick={jumpLatest}
            aria-label="Jump to latest"
            className={
              dockedAction
                ? `absolute right-4 bottom-3 z-10 inline-flex h-12 w-12 items-center justify-center rounded-full border border-line bg-surface text-ink shadow-md ${deskShiftClass} focus:outline-none focus:ring-2 focus:ring-[#0096FF]`
                : `absolute right-4 bottom-3 z-10 inline-flex h-12 min-w-12 items-center justify-center rounded-full bg-[#005CCC] px-4 text-sm font-semibold text-white shadow-lg ${deskShiftClass} focus:outline-none focus:ring-2 focus:ring-[#0096FF]`
            }
          >
            {dockedAction ? (
              <>
                <JumpGlyph />
                <span className="sr-only">Jump to latest</span>
              </>
            ) : (
              "Jump to latest"
            )}
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
