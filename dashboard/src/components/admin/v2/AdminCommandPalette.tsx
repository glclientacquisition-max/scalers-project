"use client";

import { MagnifyingGlassIcon, XMarkIcon } from "@heroicons/react/24/outline";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { StatusPill } from "@/components/ops/StatusPill";
import "@/styles/ops.css";
import {
  commandQueryReady,
  flatCommandHits,
  groupCommandHits,
  isPaletteShortcut,
  matchCommandHit,
  normalizeCommandQuery,
  type CommandHit,
} from "@/lib/ops/searchView";

/** Fixed places to jump to. Links only. */
const GO_TO: { label: string; href: string; hint: string }[] = [
  { label: "Overview", href: "/admin", hint: "Needs attention" },
  { label: "Billing home", href: "/admin/billing/home", hint: "This month and who owes" },
  { label: "Packages", href: "/admin/billing/packages", hint: "What businesses buy" },
  { label: "Businesses", href: "/admin/businesses", hint: "Waiting, live, suspended, archived" },
  { label: "Invoices", href: "/admin/billing/invoices", hint: "Overdue first" },
  { label: "Numbers", href: "/admin/numbers", hint: "Pool and assigned" },
  { label: "Quality", href: "/admin/quality", hint: "Calls going badly" },
  { label: "Settings", href: "/admin/settings/general", hint: "Hold, fee, switches" },
  { label: "Audit log", href: "/admin/settings/audit", hint: "Every admin change" },
];

type Props = {
  /** Dev fixture: search these locally instead of calling the API. */
  fixture?: CommandHit[];
  defaultOpen?: boolean;
  defaultQuery?: string;
  /** Top bar trigger style. "bar" on desktop, "icon" on phone. */
  trigger?: "bar" | "icon" | "both" | "none";
};

/** ⌘K search across businesses, numbers, invoices and calls (ADMIN_V2). Read-only: every hit is a link. */
export function AdminCommandPalette({ fixture, defaultOpen = false, defaultQuery = "", trigger = "both" }: Props) {
  const router = useRouter();
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(defaultOpen);
  const [query, setQuery] = useState(defaultQuery);
  const [hits, setHits] = useState<CommandHit[]>(() =>
    fixture && commandQueryReady(defaultQuery) ? fixture.filter((h) => matchCommandHit(h, defaultQuery)) : [],
  );
  const [state, setState] = useState<"idle" | "busy" | "done" | "error">(hits.length ? "done" : "idle");
  const [active, setActive] = useState(0);

  const groups = useMemo(() => groupCommandHits(hits), [hits]);
  const flat = useMemo(() => flatCommandHits(groups), [groups]);

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const el = e.target as HTMLElement | null;
      const targetIsField = Boolean(el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)));
      if (isPaletteShortcut({ key: e.key, metaKey: e.metaKey, ctrlKey: e.ctrlKey, targetIsField })) {
        e.preventDefault();
        setOpen(true);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    const q = normalizeCommandQuery(query);
    if (!commandQueryReady(q)) {
      setHits([]);
      setState("idle");
      return;
    }
    if (fixture) {
      setHits(fixture.filter((h) => matchCommandHit(h, q)));
      setActive(0);
      setState("done");
      return;
    }
    const ctrl = new AbortController();
    const t = window.setTimeout(() => {
      setState("busy");
      fetch(`/api/admin/search?v=2&q=${encodeURIComponent(q)}`, { signal: ctrl.signal })
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
        .then((j: { hits?: CommandHit[] }) => {
          setHits(j.hits || []);
          setActive(0);
          setState("done");
        })
        .catch((err: unknown) => {
          if ((err as { name?: string })?.name !== "AbortError") setState("error");
        });
    }, 180);
    return () => {
      ctrl.abort();
      window.clearTimeout(t);
    };
  }, [query, fixture]);

  function go(hit: CommandHit | undefined) {
    if (!hit) return;
    setOpen(false);
    setQuery("");
    router.push(hit.href);
  }

  function onInputKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => (flat.length ? (i + 1) % flat.length : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (flat.length ? (i - 1 + flat.length) % flat.length : 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      go(flat[active]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      close();
    }
  }

  const ready = commandQueryReady(query);
  const activeKey = flat[active]?.key;

  return (
    <>
      {trigger === "bar" || trigger === "both" ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className={`ops-theme ${trigger === "both" ? "hidden md:flex" : "flex"} h-8 w-full items-center gap-ops-2 rounded-sm border border-hairline bg-surface px-ops-3 text-ops-body text-ink-2 hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand`}
        >
          <MagnifyingGlassIcon aria-hidden="true" className="h-4 w-4 shrink-0" />
          <span className="min-w-0 flex-1 truncate text-start">Search businesses, numbers, invoices, calls</span>
          <kbd className="shrink-0 rounded-sm border border-hairline px-1 font-sans text-ops-label text-ink-2">⌘K</kbd>
        </button>
      ) : null}
      {trigger === "icon" || trigger === "both" ? (
        <button
          type="button"
          aria-label="Search"
          onClick={() => setOpen(true)}
          className={`${trigger === "both" ? "md:hidden" : ""} inline-flex h-11 w-11 items-center justify-center rounded-full text-ink hover:bg-surface-2`}
        >
          <MagnifyingGlassIcon aria-hidden="true" className="h-6 w-6" />
        </button>
      ) : null}

      {open ? (
        <div className="admin-theme ops-theme fixed inset-0 z-sheet flex items-start justify-center md:pt-8">
          <button type="button" aria-label="Close search" tabIndex={-1} onClick={close} className="absolute inset-0 bg-scrim/40" />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Search"
            className="relative flex h-dvh w-full flex-col bg-surface text-ink shadow-sheet md:h-auto md:max-h-[calc(100dvh-4rem)] md:max-w-2xl md:rounded-sm md:border md:border-hairline"
          >
            <div className="flex items-center gap-ops-2 border-b border-hairline px-ops-3">
              <MagnifyingGlassIcon aria-hidden="true" className="h-5 w-5 shrink-0 text-ink-2" />
              <input
                ref={inputRef}
                type="search"
                role="combobox"
                aria-expanded={flat.length > 0}
                aria-controls={listId}
                aria-activedescendant={activeKey ? `${listId}-${activeKey}` : undefined}
                aria-autocomplete="list"
                autoComplete="off"
                enterKeyHint="go"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={onInputKey}
                placeholder="Business, number, invoice or call id"
                className="h-ops-touch min-w-0 flex-1 bg-transparent text-ops-body text-ink outline-none placeholder:text-ink-2 md:h-12"
              />
              <button type="button" aria-label="Close search" onClick={close} className="inline-flex h-11 w-11 items-center justify-center rounded-full text-ink-2 hover:bg-surface-2 md:h-8 md:w-8">
                <XMarkIcon aria-hidden="true" className="h-5 w-5" />
              </button>
            </div>

            <div id={listId} role="listbox" aria-label="Results" className="min-h-0 flex-1 overflow-y-auto py-ops-2">
              {groups.map((g) => (
                <div key={g.kind} role="group" aria-label={g.label} className="pb-ops-2">
                  <div className="px-ops-3 py-1 text-ops-label font-semibold uppercase tracking-wide text-ink-2">{g.label}</div>
                  {g.hits.map((h) => {
                    const on = h.key === activeKey;
                    return (
                      <div
                        key={h.key}
                        id={`${listId}-${h.key}`}
                        role="option"
                        aria-selected={on}
                        onMouseEnter={() => setActive(flat.indexOf(h))}
                        onClick={() => go(h)}
                        className={`mx-ops-2 flex min-h-ops-touch cursor-pointer items-center gap-ops-3 rounded-sm px-ops-2 md:min-h-ops-row ${on ? "bg-surface-2" : ""}`}
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-ops-body text-ink">{h.title}</span>
                          <span className="block truncate text-ops-label text-ink-2">{h.preview}</span>
                        </span>
                        {h.archived ? <StatusPill tone="neutral">Archived</StatusPill> : null}
                      </div>
                    );
                  })}
                </div>
              ))}
              {!ready ? (
                <p className="px-ops-3 py-ops-3 text-ops-body text-ink-2">Type at least 2 characters. Numbers match with or without the leading 0 or +254.</p>
              ) : state === "busy" && !flat.length ? (
                <p className="px-ops-3 py-ops-3 text-ops-body text-ink-2">Searching</p>
              ) : state === "error" ? (
                <p className="px-ops-3 py-ops-3 text-ops-body text-ink-2">Search failed. Try again.</p>
              ) : state === "done" && !flat.length ? (
                <p className="px-ops-3 py-ops-3 text-ops-body text-ink-2">Nothing matches “{normalizeCommandQuery(query)}”. Archived businesses are included.</p>
              ) : null}
              <div role="group" aria-label="Go to" className="border-t border-hairline pt-ops-2">
                <div className="px-ops-3 py-1 text-ops-label font-semibold uppercase tracking-wide text-ink-2">Go to</div>
                {GO_TO.map((g) => (
                  <a
                    key={g.href}
                    href={g.href}
                    onClick={close}
                    className="mx-ops-2 flex min-h-ops-touch items-center gap-ops-3 rounded-sm px-ops-2 text-ops-body text-ink hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand md:min-h-ops-row"
                  >
                    <span className="min-w-0 flex-1 truncate">{g.label}</span>
                    <span className="shrink-0 text-ops-label text-ink-2">{g.hint}</span>
                  </a>
                ))}
              </div>
            </div>

            <div className="hidden items-center gap-ops-3 border-t border-hairline px-ops-3 py-ops-2 text-ops-label text-ink-2 md:flex">
              <span>↑↓ move</span>
              <span>Enter open</span>
              <span>Esc close</span>
              <span className="ms-auto">Archived businesses are labelled</span>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
