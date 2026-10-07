"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { EllipsisVerticalIcon } from "@heroicons/react/24/outline";
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
import { DeskBack, DeskRecordLead } from "@/components/ui/DeskBack";
import { DeskHint } from "@/components/ui/DeskHint";
import { IconButton, iconButtonClass } from "@/components/ui/IconButton";
import { Menu, MenuItem } from "@/components/ui/Menu";
import {
  deskShiftClass,
  metaLabelClass,
} from "@/components/ui/deskChrome";
import {
  TICKET_SPLIT_KEY,
  TICKET_SUMMARY_DEFAULT,
  TICKET_SUMMARY_MAX,
  TICKET_SUMMARY_MIN,
  clampTicketSummaryWidth,
} from "@/lib/ticketSplit";
import { ownerAssistLabel, ownerDeskLine, plainOwnerCopy } from "@/lib/deskTicketChat";
import { THREAD_PIN_PX, threadScrollAnchor, type ThreadAnchor } from "@/lib/endlessList";
import { transcriptRefreshTop } from "@/lib/deskFresh";
import { updateLeadStatus } from "@/app/(desk)/calls/actions";
import type { InboxPingPerson } from "@/components/InboxPingTeammate";
import { writeInboxArchiveUndo } from "@/lib/inboxArchiveUndo";
import { inboxMarkSeen } from "@/lib/inboxLeadActions";
import {
  inboxTicketCanMarkDone,
  inboxTicketOverflowActions,
  type InboxListActionId,
} from "@/lib/inboxListVerbs";
import type { InboxHold, InboxJob } from "@/lib/inboxPurpose";
import type { TranscriptRow } from "@/lib/supabase";
import { emptyInboxSmsFacts, type InboxSmsFacts } from "@/lib/polishInboxSms";

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
          <dt className="text-xs font-medium text-ink-soft">Mood</dt>
          <dd className="mt-1 text-sm text-ink">{plainOwnerCopy(mood)}</dd>
        </div>
      ) : null}
      {done ? (
        <div>
          <dt className="text-xs font-medium text-ink-soft">Done</dt>
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
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<InboxListActionId | null>(null);
  const actions = inboxTicketOverflowActions({ archived });

  async function run(id: InboxListActionId) {
    setBusy(true);
    setPendingId(id);
    const next = id === "unarchive" || archived ? "new" : "archived";
    const res = await updateLeadStatus(callId, next);
    setBusy(false);
    setPendingId(null);
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

  return (
    <Menu
      open={open}
      onOpenChange={(next) => {
        if (!next && busy) return;
        if (next) setError(null);
        setOpen(next);
      }}
      trigger={
        <button type="button" aria-label="More" className={iconButtonClass({ size: "sm" })}>
          <EllipsisVerticalIcon aria-hidden="true" />
        </button>
      }
    >
      {actions.map((action) => (
        <MenuItem
          key={action.id}
          disabled={busy}
          onClick={() => void run(action.id)}
        >
          {pendingId === action.id ? "Saving" : action.label}
        </MenuItem>
      ))}
      {error ? (
        <p className="px-3 py-2 text-caption text-attention" role="alert">
          {error}
        </p>
      ) : null}
    </Menu>
  );
}

function ticketSmsFacts(opts: {
  businessName: string;
  callerName: string | null;
  want: string | null;
  purpose: string;
  job: InboxJob | null;
  hold: InboxHold | null;
}): InboxSmsFacts {
  const job = opts.job;
  const hold = opts.hold;
  return {
    ...emptyInboxSmsFacts(),
    businessName: String(opts.businessName || "").trim(),
    callerName: String(opts.callerName || "").trim(),
    want: String(opts.want || "").trim(),
    purpose: String(opts.purpose || "").trim(),
    jobStatus: String(job?.status || "").trim(),
    jobService: String(job?.service_name || "").trim(),
    jobWhen: String(job?.when_text || "").trim(),
    jobPlace: String(job?.address_landmark || "").trim(),
    holdStatus: String(hold?.status || "").trim(),
    holdType: String(hold?.request_type || "").trim(),
    holdItem: String(hold?.item || "").trim(),
    holdWhen: String(hold?.when_text || "").trim(),
  };
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
  bannerWhen = null,
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
  businessName,
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
  /** Silence banner clock. Other banners stay a next step only. */
  bannerWhen?: string | null;
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
  businessName: string;
}) {
  const paneRef = useRef<HTMLDivElement>(null);
  const threadRef = useRef<HTMLDivElement>(null);
  const splitRef = useRef<HTMLDivElement>(null);
  const threadPlaceRef = useRef<{ anchor: ThreadAnchor; scrollTop: number }>({
    anchor: "latest",
    scrollTop: 0,
  });
  const threadFreezeRef = useRef(false);
  const seenTurnsRef = useRef(turns.length);
  if (seenTurnsRef.current !== turns.length) {
    seenTurnsRef.current = turns.length;
    threadFreezeRef.current = true;
  }
  const [away, setAway] = useState(false);
  const [summaryW, setSummaryW] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const [gripHot, setGripHot] = useState(false);
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
  const smsFacts = ticketSmsFacts({
    businessName,
    callerName,
    want,
    purpose,
    job,
    hold,
  });

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

  useLayoutEffect(() => {
    let writing = false;

    function scrollerEl() {
      return window.matchMedia("(min-width: 1024px)").matches
        ? threadRef.current
        : paneRef.current;
    }

    function measure() {
      const el = scrollerEl();
      if (!el) return;
      setAway(el.scrollHeight - el.scrollTop - el.clientHeight > THREAD_PIN_PX);
    }

    function readStick(el: HTMLElement): ThreadAnchor {
      const marked = el.getAttribute("data-thread-stick");
      if (marked === "latest" || marked === "older" || marked === "start") return marked;
      return threadPlaceRef.current.anchor;
    }

    function applyStick(el: HTMLElement, stick: ThreadAnchor) {
      writing = true;
      el.setAttribute("data-thread-stick", stick);
      const saved =
        threadPlaceRef.current.anchor === stick ? threadPlaceRef.current.scrollTop : el.scrollTop;
      const next = transcriptRefreshTop({
        anchor: stick,
        scrollTop: saved,
        scrollHeight: el.scrollHeight,
        clientHeight: el.clientHeight,
      });
      if (el.scrollTop !== next) el.scrollTop = next;
      threadPlaceRef.current = { anchor: stick, scrollTop: next };
      threadFreezeRef.current = false;
      writing = false;
    }

    function bind() {
      const scroller = scrollerEl();
      if (!scroller) {
        threadFreezeRef.current = false;
        return () => {};
      }
      const el: HTMLElement = scroller;
      applyStick(el, readStick(el));
      requestAnimationFrame(() => {
        if (!el.isConnected || readStick(el) !== "latest") return;
        applyStick(el, "latest");
      });
      function onScroll() {
        if (!writing && !threadFreezeRef.current) {
          const anchor = threadScrollAnchor({
            scrollTop: el.scrollTop,
            scrollHeight: el.scrollHeight,
            clientHeight: el.clientHeight,
          });
          el.setAttribute("data-thread-stick", anchor);
          threadPlaceRef.current = { anchor, scrollTop: el.scrollTop };
        }
        measure();
      }
      el.addEventListener("scroll", onScroll);
      measure();
      return () => el.removeEventListener("scroll", onScroll);
    }

    let unbind = bind();
    const mq = window.matchMedia("(min-width: 1024px)");
    const onChange = () => {
      unbind();
      unbind = bind();
    };
    const onResize = () => {
      const el = scrollerEl();
      if (el) {
        const stick = readStick(el);
        if (stick !== "older") applyStick(el, stick);
      }
      measure();
    };
    mq.addEventListener("change", onChange);
    window.addEventListener("resize", onResize);
    return () => {
      unbind();
      mq.removeEventListener("change", onChange);
      window.removeEventListener("resize", onResize);
    };
  }, [turns.length]);

  return (
    <div
      data-desk-bleed=""
      data-ticket-chat=""
      className="flex h-full min-h-0 flex-1 flex-col pt-[var(--desk-header-h)] pb-[env(safe-area-inset-bottom,0px)] md:pb-0"
    >
      <header className="shrink-0 border-b border-line bg-surface px-2 pb-2 pt-[max(0.5rem,env(safe-area-inset-top,0px))] sm:px-4">
        <DeskRecordLead
          align="center"
          back={
            <DeskBack href={backHref}>{backHref === "/home" ? "Home" : "Inbox"}</DeskBack>
          }
          trail={
            <InboxTicketMore
              callId={callId}
              backHref={backHref}
              archived={archived}
            />
          }
        >
          <ContactStrip
            name={callerName}
            phone={callerPhone}
            lastContactAt={lastContactAt}
            profileHref={contactHref}
          />
        </DeskRecordLead>
      </header>

      {needsYou && (urgency || bannerWhen) ? (
        <p className="shrink-0 border-b border-warn/40 bg-warn-soft px-4 py-2 text-sm font-medium text-warn sm:px-6">
          {urgency ? plainOwnerCopy(urgency) : null}
          {bannerWhen ? (
            <span className={urgency ? "font-normal" : undefined}>
              {urgency ? " · " : ""}
              {plainOwnerCopy(bannerWhen)}
            </span>
          ) : null}
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
          data-pull-scroll=""
          className="absolute inset-0 overflow-y-auto lg:contents"
        >
          <aside
            data-ticket-summary=""
            data-pull-scroll=""
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
              {(() => {
                const assist = ownerAssistLabel(assistLabel);
                const note = ownerDeskLine(assistNote);
                const delivery = ownerDeskLine(escalationDelivery);
                const noteLine = note && note !== assist ? note : null;
                const deliveryLine =
                  delivery && delivery !== assist && delivery !== noteLine ? delivery : null;
                return (
                  <>
                    {assist ? (
                      <p>
                        {assist === "Requested owner callback" ? assist : `Assist: ${assist}`}
                      </p>
                    ) : null}
                    {noteLine ? (
                      <p className="[overflow-wrap:anywhere]">{noteLine}</p>
                    ) : null}
                    {deliveryLine ? (
                      <p data-escalation-delivery="" className="[overflow-wrap:anywhere]">
                        {deliveryLine}
                      </p>
                    ) : null}
                  </>
                );
              })()}
              {escalatedLine ? (
                <p data-escalation-target="" className="[overflow-wrap:anywhere]">
                  {plainOwnerCopy(escalatedLine)}
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
            open={dragging || gripHot}
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
                onPointerEnter={() => setGripHot(true)}
                onPointerLeave={() => setGripHot(false)}
                className={[
                  "absolute top-1/2 left-1/2 z-10 h-11 w-6 -translate-x-1/2 -translate-y-1/2 rounded-full",
                  dragging ? "bg-accent/25" : "hover:bg-accent/15",
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
              data-pull-scroll=""
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
                className={`inline-flex h-12 w-12 items-center justify-center rounded-full border border-line bg-surface text-ink shadow-md ${deskShiftClass} focus:outline-none focus:ring-2 focus:ring-brand`}
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
              className={`absolute right-4 bottom-3 z-10 inline-flex h-12 min-w-12 items-center justify-center rounded-full border border-line bg-surface px-4 text-sm font-semibold text-ink shadow-md ${deskShiftClass} focus:outline-none focus:ring-2 focus:ring-brand`}
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

      {!archived ? (
        <InboxSmsDock
          callId={callId}
          callerPhone={callerPhone}
          facts={smsFacts}
        />
      ) : null}
    </div>
  );
}
