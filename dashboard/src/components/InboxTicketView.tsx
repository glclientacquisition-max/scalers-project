"use client";

import Link from "next/link";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
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
import { writeInboxArchiveUndo } from "@/lib/inboxArchiveUndo";
import { inboxTicketOverflowActions } from "@/lib/inboxListVerbs";
import {
  placeInboxOverflowMenu,
  type InboxOverflowAnchor,
} from "@/lib/inboxOverflowPlace";
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

function MoreGlyph() {
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

function InboxTicketMore({
  callId,
  backHref,
  archived,
}: {
  callId: string;
  backHref: string;
  archived: boolean;
}) {
  const router = useRouter();
  const labelId = useId();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [anchor, setAnchor] = useState<InboxOverflowAnchor | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const ignoreUntil = useRef(0);
  const actions = inboxTicketOverflowActions(archived);

  function placeFromButton() {
    const rect = btnRef.current?.getBoundingClientRect();
    setAnchor(
      rect
        ? { x: rect.left, y: rect.top, w: rect.width, h: rect.height, align: "end" }
        : { x: 8, y: 8, align: "point" }
    );
  }

  useLayoutEffect(() => {
    if (!open || !anchor) return;
    const nextAnchor = anchor;
    function place() {
      const el = panelRef.current;
      if (!el) return;
      const view = window.visualViewport;
      setPos(
        placeInboxOverflowMenu(
          { width: el.offsetWidth, height: el.offsetHeight },
          nextAnchor,
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
  }, [open, anchor, error, actions.length]);

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    panelRef.current?.querySelector<HTMLElement>("[role='menuitem']")?.focus();

    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        if (!busy) setOpen(false);
      }
    }

    function onPointer(event: MouseEvent) {
      if (Date.now() < ignoreUntil.current) return;
      if (panelRef.current && !panelRef.current.contains(event.target as Node) && !busy) {
        setOpen(false);
      }
    }

    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onPointer);
      previous?.focus?.();
    };
  }, [open, busy]);

  async function run() {
    setBusy(true);
    const res = await updateLeadStatus(callId, archived ? "new" : "archived");
    setBusy(false);
    if (res.error) {
      setError(res.error);
      return;
    }
    setOpen(false);
    if (!archived) {
      writeInboxArchiveUndo([{ id: callId, callId }]);
      router.push(backHref);
    }
    router.refresh();
  }

  const menu = (
    <div
      ref={panelRef}
      role="menu"
      aria-labelledby={labelId}
      className="z-[60] max-h-[min(24rem,calc(100dvh-1rem))] min-w-[10rem] overflow-y-auto rounded-xl border border-line bg-surface py-1 shadow-xl"
      style={{
        position: "fixed",
        top: pos?.top ?? 0,
        left: pos?.left ?? 0,
        visibility: pos ? "visible" : "hidden",
      }}
      onClick={(event) => event.stopPropagation()}
    >
      <p id={labelId} className="sr-only">
        More
      </p>
      {actions.map((action) => (
        <button
          key={action.id}
          type="button"
          role="menuitem"
          disabled={busy}
          className={`flex min-h-11 w-full items-center px-4 text-left text-sm text-ink ${focusRingVisible} hover:bg-surface-muted disabled:opacity-50`}
          onClick={() => void run()}
        >
          {busy ? "Saving" : archived ? "Unarchive" : "Archive"}
        </button>
      ))}
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
            placeFromButton();
          }
          setOpen((next) => !next);
        }}
      >
        <MoreGlyph />
      </button>
      {open && typeof document !== "undefined" ? createPortal(menu, document.body) : null}
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
  const canConfirm = !archived && String(job?.status || "").toLowerCase() === "requested";
  const canHoldDone = !archived && String(hold?.status || "").toLowerCase() === "open";
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

  function jumpLatest() {
    const el = scroller();
    el?.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }

  useEffect(() => {
    function scrollerEl() {
      return window.matchMedia("(min-width: 1024px)").matches
        ? threadRef.current
        : paneRef.current;
    }
    function measure() {
      const el = scrollerEl();
      if (!el) return;
      setAway(el.scrollHeight - el.scrollTop - el.clientHeight > 96);
    }
    function bind() {
      const el = scrollerEl();
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
      <header className="shrink-0 border-b border-line bg-surface px-2 py-1 sm:px-4">
        <div className="flex items-center gap-1">
          <DeskBack href={backHref}>Inbox</DeskBack>
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
          <InboxTicketMore callId={callId} backHref={backHref} archived={archived} />
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
