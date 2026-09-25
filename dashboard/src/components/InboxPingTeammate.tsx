"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { pingTeammateAction } from "@/app/(desk)/calls/escalateActions";
import { DeskHint } from "@/components/ui/DeskHint";
import {
  btnGhost,
  deskHitClass,
  deskShiftClass,
  focusRingVisible,
  pendingSpinnerClass,
  pendingSpinnerInkClass,
} from "@/components/ui/deskChrome";
import {
  placeInboxOverflowMenu,
  type InboxOverflowAnchor,
} from "@/lib/inboxOverflowPlace";

export type InboxPingPerson = {
  name: string;
  role: string;
  phone: string;
  email?: string;
};

function PingGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" aria-hidden="true">
      <path
        d="M12 12a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4Z"
        stroke="currentColor"
        strokeWidth="1.8"
      />
      <path
        d="M5.6 18.4a6.6 6.6 0 0 1 12.8 0"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path
        d="M16.8 7.2 19 5m-11.8 2.2L5 5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function InboxPingTeammate({
  callId,
  people,
  archived,
  variant = "block",
}: {
  callId: string;
  people: InboxPingPerson[];
  archived: boolean;
  variant?: "block" | "dock";
}) {
  const router = useRouter();
  const labelId = useId();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [line, setLine] = useState<string | null>(null);
  const [picked, setPicked] = useState(people[0]?.name || "");
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [anchor, setAnchor] = useState<InboxOverflowAnchor | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const ignoreUntil = useRef(0);
  const one = people.length === 1 ? people[0] : null;
  const hidden = archived || people.length === 0;

  function run(name: string) {
    if (pending) return;
    setError(null);
    setOpen(false);
    setPending(true);
    void (async () => {
      const res = await pingTeammateAction({ callId, teammateName: name });
      setPending(false);
      if (res.line) setLine(res.line);
      if (res.error && res.error !== res.line) setError(res.error);
      else if (!res.ok && !res.failed) setError(res.error || "Could not ping.");
      router.refresh();
    })();
  }

  function placeFromButton() {
    const rect = btnRef.current?.getBoundingClientRect();
    setAnchor(
      rect
        ? { x: rect.left, y: rect.top, w: rect.width, h: rect.height, align: "end" }
        : { x: 8, y: 8, align: "point" }
    );
  }

  useLayoutEffect(() => {
    if (!open || !anchor || variant !== "dock") return;
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
  }, [open, anchor, variant, people.length]);

  useEffect(() => {
    if (!open || variant !== "dock") return;
    const previous = document.activeElement as HTMLElement | null;
    panelRef.current?.querySelector<HTMLElement>("[role='menuitem']")?.focus();

    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        if (!pending) setOpen(false);
      }
    }

    function onPointer(event: MouseEvent) {
      if (Date.now() < ignoreUntil.current) return;
      if (panelRef.current && !panelRef.current.contains(event.target as Node) && !pending) {
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
  }, [open, pending, variant]);

  if (hidden) return null;

  if (variant === "dock") {
    const hint = one ? `Ping ${one.name}` : "Ping teammate";
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
          Ping teammate
        </p>
        {people.map((person) => (
          <button
            key={`${person.name}-${person.phone}`}
            type="button"
            role="menuitem"
            disabled={pending}
            className={`flex min-h-11 w-full items-center px-4 text-left text-sm text-ink ${focusRingVisible} hover:bg-surface-muted disabled:opacity-50`}
            onClick={() => run(person.name)}
          >
            {pending ? "Pinging" : person.name}
            {person.role ? ` (${person.role})` : ""}
          </button>
        ))}
      </div>
    );

    return (
      <div className="flex w-16 flex-col items-center gap-1">
        <DeskHint label={hint} side="top">
          <button
            ref={btnRef}
            type="button"
            disabled={pending}
            aria-busy={pending}
            aria-label={pending ? "Pinging" : hint}
            aria-haspopup={one ? undefined : "menu"}
            aria-expanded={one ? undefined : open}
            title={pending ? "Pinging" : hint}
            onClick={() => {
              if (one) {
                run(one.name);
                return;
              }
              setError(null);
              if (!open) {
                ignoreUntil.current = Date.now() + 450;
                placeFromButton();
              }
              setOpen((next) => !next);
            }}
            className={`${deskHitClass} border border-line bg-surface text-ink ${deskShiftClass} ${focusRingVisible} hover:border-accent disabled:opacity-50`}
          >
            {pending ? (
              <span aria-hidden="true" className={pendingSpinnerInkClass} />
            ) : (
              <PingGlyph />
            )}
          </button>
        </DeskHint>
        <span className="text-[11px] font-medium leading-none text-ink-soft">Ping</span>
        {open && typeof document !== "undefined" ? createPortal(menu, document.body) : null}
        {line ? <p className="max-w-[6.5rem] text-center text-[11px] text-ink-soft [overflow-wrap:anywhere]">{line}</p> : null}
        {error ? (
          <p className="max-w-[6.5rem] text-center text-[11px] text-warn [overflow-wrap:anywhere]" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {one ? (
        <button
          type="button"
          disabled={pending}
          onClick={() => run(one.name)}
          className={`${btnGhost} w-full gap-2`}
        >
          {pending ? <span className={pendingSpinnerClass} aria-hidden="true" /> : null}
          {pending ? "Pinging" : `Ping ${one.name}`}
        </button>
      ) : (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <label className="sr-only" htmlFor={`ping-teammate-${callId}`}>
            Teammate
          </label>
          <select
            id={`ping-teammate-${callId}`}
            value={picked}
            disabled={pending}
            onChange={(event) => setPicked(event.target.value)}
            className={`min-h-12 min-w-0 flex-1 rounded-xl border border-line bg-surface px-3 text-sm text-ink ${focusRingVisible} focus:outline-none focus:ring-2 focus:ring-[#0096FF]`}
          >
            {people.map((person) => (
              <option key={`${person.name}-${person.phone}`} value={person.name}>
                {person.name}
                {person.role ? ` (${person.role})` : ""}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={pending || !picked}
            onClick={() => run(picked)}
            className={`${btnGhost} shrink-0 gap-2`}
          >
            {pending ? <span className={pendingSpinnerClass} aria-hidden="true" /> : null}
            {pending ? "Pinging" : "Ping teammate"}
          </button>
        </div>
      )}
      {line ? <p className="text-xs text-ink-soft [overflow-wrap:anywhere]">{line}</p> : null}
      {error ? (
        <p className="text-xs text-warn [overflow-wrap:anywhere]" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
