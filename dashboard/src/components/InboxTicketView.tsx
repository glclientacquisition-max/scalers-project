"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { CallRecording } from "@/components/CallRecording";
import { CallTranscript } from "@/components/CallTranscript";
import { InboxHoldEditor } from "@/components/InboxHoldEditor";
import { InboxJobActions } from "@/components/InboxJobActions";
import { InboxJobEditor } from "@/components/InboxJobEditor";
import { InboxPurposeChip } from "@/components/InboxPurposeChip";
import { InboxSmsDock } from "@/components/InboxSmsDock";
import { RequestStatusToggle } from "@/components/RequestStatusToggle";
import { InboxTicketActionDock } from "@/components/InboxTicketActionDock";
import { ContactStrip } from "@/components/ContactStrip";
import { DeskBack } from "@/components/ui/DeskBack";
import { DeskHint } from "@/components/ui/DeskHint";
import {
  deskHitClass,
  deskShiftClass,
  focusRingVisible,
  metaLabelClass,
} from "@/components/ui/deskChrome";
import {
  TICKET_SPLIT_KEY,
  TICKET_SUMMARY_DEFAULT,
  TICKET_SUMMARY_MAX,
  TICKET_SUMMARY_MIN,
  clampTicketSummaryWidth,
} from "@/lib/ticketSplit";
import { plainOwnerCopy } from "@/lib/deskTicketChat";
import { updateLeadStatus } from "@/app/(desk)/calls/actions";
import type { InboxPingPerson } from "@/components/InboxPingTeammate";
import { writeInboxArchiveUndo } from "@/lib/inboxArchiveUndo";
import { inboxMarkSeen } from "@/lib/inboxLeadActions";
import {
  inboxTicketCanMarkDone,
  inboxTicketOverflowActions,
  type InboxListActionId,
} from "@/lib/inboxListVerbs";
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
          <dd className="mt-1 text-sm text-ink [overflow-wrap:anywhere]">{plainOwnerCopy(want)}</dd>
        </div>
      ) : null}
      {mood ? (
        <div>
          <dt className={metaLabelClass}>Mood</dt>
          <dd className="mt-1 text-sm text-ink">{plainOwnerCopy(mood)}</dd>
        </div>
      ) : null}
      {done ? (
        <div>
          <dt className={metaLabelClass}>Done</dt>
          <dd className="mt-1 text-sm text-ink [overflow-wrap:anywhere]">{plainOwnerCopy(done)}</dd>
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
  const actions = inboxTicketOverflowActions({ archived });

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

  async function run(id: InboxListActionId) {
    setBusy(true);
    const next = id === "unarchive" || archived ? "new" : "archived";
    const res = await updateLeadStatus(callId, next);
    setBusy(false);
    if (res.error) {
      setError(res.error);
      return;
    }
    setOpen(false);
    if (id === "archive" && !archived) {
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
          onClick={() => void run(action.id)}
        >
          {busy ? "Saving" : action.label}
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
      <DeskHint label="More" side="top">
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
      </DeskHint>
      {open && typeof document !== "undefined" ? createPortal(menu, document.body) : null}
    </div>
  );
}

export function InboxTicketView({
  callId,
  backHref,
  contactHref,
  callerName,
  lastContactAt,
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
  recordingUrl,
  durationLabel,
  assistLabel,
  assistNote,
  escalatedLine,
  escalationDelivery,
  liveConnectLine,
  escalatePeople,
  archived,
  leadStatus,
}: {
  callId: string;
  backHref: string;
  contactHref: string | null;
  callerName: string | null;
  lastContactAt: string | null;
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
  recordingUrl: string | null;
  durationLabel: string;
  assistLabel: string | null;
  assistNote: string | null;
  escalatedLine: string | null;
  escalationDelivery: string | null;
  liveConnectLine: string | null;
  escalatePeople: InboxPingPerson[];
  archived: boolean;
  leadStatus: string | null;
}) {
  const paneRef = useRef<HTMLDivElement>(null);
  const threadRef = useRef<HTMLDivElement>(null);
  const splitRef = useRef<HTMLDivElement>(null);
  const [away, setAway] = useState(false);
  const [summaryW, setSummaryW] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const summaryWRef = useRef<number | null>(null);
  const canConfirm = !archived && String(job?.status || "").toLowerCase() === "requested";
  const canHoldDone = !archived && String(hold?.status || "").toLowerCase() === "open";
  const canMarkDone = inboxTicketCanMarkDone({
    archived,
    purpose,
    hasJob: Boolean(job),
    hasHold: Boolean(hold),
    leadStatus,
  });
  const canPing = !archived && escalatePeople.length > 0;
  const showActionDock = canMarkDone || Boolean(callerPhone) || canPing;
  const dockedAction =
    canConfirm || canHoldDone || (needsYou && !archived) || showActionDock;

  useEffect(() => {
    void inboxMarkSeen(callId);
  }, [callId]);

  useEffect(() => {
    summaryWRef.current = summaryW;
  }, [summaryW]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(TICKET_SPLIT_KEY);
      const next = raw ? Number.parseInt(raw, 10) : NaN;
      if (Number.isFinite(next)) setSummaryW(next);
    } catch {
      /* ignore */
    }
  }, []);

  const persistSummary = useCallback((next: number | null) => {
    setSummaryW(next);
    try {
      if (next == null) localStorage.removeItem(TICKET_SPLIT_KEY);
      else localStorage.setItem(TICKET_SPLIT_KEY, String(next));
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    const node = splitRef.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      const box = node.getBoundingClientRect();
      const current = summaryWRef.current;
      if (current == null) return;
      const next = clampTicketSummaryWidth(current, box.width);
      if (next !== current) persistSummary(next);
    });
    ro.observe(node);
    return () => ro.disconnect();
  }, [persistSummary]);

  const applySummaryFromClientX = useCallback(
    (clientX: number) => {
      const box = splitRef.current?.getBoundingClientRect();
      if (!box) return;
      persistSummary(clampTicketSummaryWidth(clientX - box.left, box.width));
    },
    [persistSummary]
  );

  useEffect(() => {
    if (!dragging) return;
    function move(event: PointerEvent) {
      applySummaryFromClientX(event.clientX);
    }
    function up() {
      setDragging(false);
    }
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
  }, [dragging, applySummaryFromClientX]);
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
    <div
      data-desk-bleed=""
      data-ticket-chat=""
      className="-mx-4 -mb-[var(--desk-tabbar-clearance)] -mt-6 flex h-[calc(100dvh-var(--desk-header-h))] min-h-0 flex-col pb-[calc(var(--desk-tabbar-h)+env(safe-area-inset-bottom,0px))] sm:-mx-6 sm:-mt-10 md:mx-0 md:mb-0 md:mt-0 md:h-full md:pb-0"
    >
      <header className="shrink-0 border-b border-line bg-surface px-2 py-2 sm:px-4">
        <div className="flex items-center gap-1">
          <DeskBack href={backHref}>Inbox</DeskBack>
          <ContactStrip
            name={callerName}
            phone={callerPhone}
            lastContactAt={lastContactAt}
            profileHref={contactHref}
          />
          <InboxTicketMore
            callId={callId}
            backHref={backHref}
            archived={archived}
          />
        </div>
      </header>

      {needsYou && urgency ? (
        <p className="shrink-0 border-b border-warn/40 bg-warn-soft px-4 py-2 text-sm font-medium text-warn sm:px-6">
          {plainOwnerCopy(urgency)}
        </p>
      ) : null}

      <div
        ref={splitRef}
        data-ticket-split=""
        style={
          summaryW
            ? ({ "--ticket-summary-w": `${summaryW}px` } as CSSProperties)
            : undefined
        }
        className={[
          "relative min-h-0 flex-1 lg:grid lg:grid-cols-[minmax(18rem,var(--ticket-summary-w,22rem))_1px_minmax(0,1fr)] lg:grid-rows-[minmax(0,1fr)]",
          dragging ? "select-none" : "",
        ].join(" ")}
      >
        <div
          ref={paneRef}
          className="absolute inset-0 overflow-y-auto lg:contents"
        >
          <aside
            data-ticket-summary=""
            className="space-y-4 px-4 py-4 sm:px-6 lg:min-h-0 lg:overflow-y-auto"
          >
            <InboxPurposeChip purpose={purpose} label={plainOwnerCopy(stamp)} />
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
              <p>Duration: {plainOwnerCopy(durationLabel)}</p>
              {assistLabel ? <p>Assist: {plainOwnerCopy(assistLabel)}</p> : null}
              {assistNote ? (
                <p className="[overflow-wrap:anywhere]">{plainOwnerCopy(assistNote)}</p>
              ) : null}
              {escalatedLine ? (
                <p data-escalation-target="" className="[overflow-wrap:anywhere]">
                  {plainOwnerCopy(escalatedLine)}
                </p>
              ) : null}
              {escalationDelivery ? (
                <p data-escalation-delivery="" className="[overflow-wrap:anywhere]">
                  {escalationDelivery}
                </p>
              ) : null}
              {liveConnectLine ? (
                <p data-live-connect="" className="[overflow-wrap:anywhere]">
                  {liveConnectLine}
                </p>
              ) : null}
              <CallRecording recordingUrl={recordingUrl} />
            </div>
          </aside>
          <DeskHint
            label="Summary width"
            className="relative z-10 hidden h-full w-px shrink-0 lg:flex"
          >
            <div
              role="separator"
              aria-orientation="vertical"
              aria-label="Summary width"
              aria-valuemin={TICKET_SUMMARY_MIN}
              aria-valuemax={TICKET_SUMMARY_MAX}
              aria-valuenow={Math.min(
                TICKET_SUMMARY_MAX,
                Math.max(TICKET_SUMMARY_MIN, summaryW ?? TICKET_SUMMARY_DEFAULT)
              )}
              tabIndex={0}
              onPointerDown={(event) => {
                event.preventDefault();
                (event.target as HTMLElement).focus();
                setDragging(true);
                applySummaryFromClientX(event.clientX);
              }}
              onDoubleClick={() => persistSummary(null)}
              onKeyDown={(event) => {
                if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
                event.preventDefault();
                const box = splitRef.current?.getBoundingClientRect();
                if (!box) return;
                const current = summaryWRef.current ?? TICKET_SUMMARY_DEFAULT;
                const step = event.key === "ArrowLeft" ? -16 : 16;
                persistSummary(clampTicketSummaryWidth(current + step, box.width));
              }}
              className={[
                "relative h-full w-px shrink-0 cursor-col-resize touch-none",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
              ].join(" ")}
            >
              <span
                aria-hidden="true"
                className={[
                  "absolute inset-y-0 left-1/2 z-10 w-6 -translate-x-1/2",
                  dragging ? "bg-accent/15" : "hover:bg-accent/10",
                ].join(" ")}
              />
              <span
                aria-hidden="true"
                className={[
                  "absolute inset-y-0 left-1/2 w-px -translate-x-1/2",
                  dragging ? "bg-accent" : "bg-line",
                ].join(" ")}
              />
            </div>
          </DeskHint>
          <section data-ticket-thread="" className="relative min-h-0">
            <div
              ref={threadRef}
              className="space-y-2.5 px-4 py-4 sm:px-6 lg:absolute lg:inset-0 lg:overflow-y-auto"
            >
              <CallTranscript turns={turns} mode="thread" />
            </div>
          </section>
        </div>
        {away ? (
          dockedAction ? (
            <DeskHint label="Jump to latest" side="top" className="absolute right-4 bottom-3 z-10 inline-flex">
              <button
                type="button"
                onClick={jumpLatest}
                aria-label="Jump to latest"
                className={`inline-flex h-12 w-12 items-center justify-center rounded-full border border-line bg-surface text-ink shadow-md ${deskShiftClass} focus:outline-none focus:ring-2 focus:ring-[#0096FF]`}
              >
                <JumpGlyph />
                <span className="sr-only">Jump to latest</span>
              </button>
            </DeskHint>
          ) : (
            <button
              type="button"
              onClick={jumpLatest}
              aria-label="Jump to latest"
              className={`absolute right-4 bottom-3 z-10 inline-flex h-12 min-w-12 items-center justify-center rounded-full bg-[#005CCC] px-4 text-sm font-semibold text-white shadow-lg ${deskShiftClass} focus:outline-none focus:ring-2 focus:ring-[#0096FF]`}
            >
              Jump to latest
            </button>
          )
        ) : null}
      </div>

      <InboxTicketActionDock
        callId={callId}
        callerPhone={callerPhone}
        waMessage={waMessage}
        canMarkDone={canMarkDone}
        escalatePeople={escalatePeople}
        archived={archived}
      />

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
