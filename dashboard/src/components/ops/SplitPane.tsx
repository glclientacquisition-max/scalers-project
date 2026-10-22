"use client";

import { XMarkIcon } from "@heroicons/react/24/outline";
import { useEffect, useRef, type ReactNode } from "react";
import { Sheet } from "@/components/ui/Sheet";
import { useIsPhone } from "@/components/ui/useIsPhone";
import { PANE_HEADINGS as HEAD, paneSections } from "@/lib/ops/pane";

export { paneSections };

export type PaneFact = { label: string; value: ReactNode };
export type PaneChange = { label: string; from: ReactNode; to: ReactNode };
export type PaneEvent = { when: string; what: ReactNode; who?: string };
export type PaneLink = { label: string; href: string; meta?: ReactNode };

export type PaneSections = {
  facts?: PaneFact[];
  changes?: PaneChange[];
  history?: PaneEvent[];
  related?: PaneLink[];
};

function PaneBody(s: PaneSections) {
  const keys = paneSections(s);
  return (
    <div className="flex flex-col divide-y divide-hairline">
      {keys.map((k) => (
        <section key={k} data-pane-section={k} className="flex flex-col gap-ops-2 py-ops-3 first:pt-0">
          <h3 className="text-ops-label font-semibold uppercase tracking-wide text-ink-2">{HEAD[k]}</h3>
          {k === "facts" ? (
            <dl className="grid grid-cols-[minmax(7rem,auto)_1fr] gap-x-ops-4 gap-y-ops-1 text-ops-body">
              {s.facts!.map((f) => (
                <div key={f.label} className="contents">
                  <dt className="text-ink-2">{f.label}</dt>
                  <dd className="min-w-0 text-ink tabular-nums">{f.value}</dd>
                </div>
              ))}
            </dl>
          ) : null}
          {k === "changes" ? (
            <table className="w-full text-ops-body">
              <thead className="text-start text-ops-label text-ink-2">
                <tr><th className="py-1 text-start font-normal">Field</th><th className="py-1 text-start font-normal">Now</th><th className="py-1 text-start font-normal">After</th></tr>
              </thead>
              <tbody className="divide-y divide-hairline">
                {s.changes!.map((c) => (
                  <tr key={c.label}>
                    <td className="py-1.5 pe-ops-3 text-ink-2">{c.label}</td>
                    <td className="py-1.5 pe-ops-3 text-ink-2 line-through decoration-ink-3">{c.from}</td>
                    <td className="py-1.5 font-semibold text-ink">{c.to}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
          {k === "history" ? (
            <ol className="flex flex-col gap-ops-1 text-ops-body">
              {s.history!.map((e, i) => (
                <li key={i} className="grid min-h-ops-row grid-cols-[7.5rem_1fr] items-center gap-ops-3 border-b border-hairline last:border-b-0">
                  <span className="text-ink-2 tabular-nums">{e.when}</span>
                  <span className="min-w-0 text-ink">{e.what}{e.who ? <span className="text-ink-2"> · {e.who}</span> : null}</span>
                </li>
              ))}
            </ol>
          ) : null}
          {k === "related" ? (
            <ul className="flex flex-col text-ops-body">
              {s.related!.map((r) => (
                <li key={r.href}>
                  <a href={r.href} className="flex min-h-ops-touch items-center justify-between gap-ops-3 rounded-sm px-1 text-ink hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand md:min-h-ops-row">
                    <span className="min-w-0 truncate">{r.label}</span>
                    {r.meta ? <span className="shrink-0 text-ink-2">{r.meta}</span> : null}
                  </a>
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ))}
    </div>
  );
}

type Props = PaneSections & {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: ReactNode;
  /** Confirm action and any code field. Always pinned to the bottom of the pane. */
  footer?: ReactNode;
  dismissible?: boolean;
};

/**
 * Split pane. md and up: sits beside the list in the page flow (no overlay, the list stays usable).
 * Width 560px, 640px from 1440. Below md: the shared bottom sheet. Never a centred modal.
 */
export function SplitPane({ open, onClose, title, subtitle, footer, dismissible = true, ...sections }: Props) {
  const phone = useIsPhone();
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!open || phone) return;
    const root = document.documentElement;
    root.dataset.paneOpen = "";
    return () => { delete root.dataset.paneOpen; };
  }, [open, phone]);
  useEffect(() => {
    if (!open || phone) return;
    ref.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && dismissible) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, phone, dismissible, onClose]);

  if (phone) {
    return (
      <Sheet open={open} onOpenChange={(n) => { if (!n && dismissible) onClose(); }} title={title} footer={footer} dismissible={dismissible} theme="admin">
        <div className="ops-theme">
          {subtitle ? <p className="mb-ops-3 text-ops-body text-ink-2">{subtitle}</p> : null}
          <PaneBody {...sections} />
        </div>
      </Sheet>
    );
  }
  if (!open) return null;
  return (
    <aside
      ref={ref}
      tabIndex={-1}
      aria-label={title}
      data-split-pane=""
      className="ops-split-pane ops-theme flex min-h-0 flex-col border-s border-hairline bg-surface text-ink outline-none"
    >
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-hairline px-ops-4">
        <h2 className="min-w-0 flex-1 truncate text-ops-heading">{title}</h2>
        {dismissible ? (
          <button type="button" onClick={onClose} aria-label="Close" className="-me-2 inline-flex h-9 w-9 items-center justify-center rounded-sm text-ink-2 hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand">
            <XMarkIcon className="h-5 w-5" aria-hidden="true" />
          </button>
        ) : null}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-ops-4 py-ops-3">
        {subtitle ? <p className="mb-ops-3 text-ops-body text-ink-2">{subtitle}</p> : null}
        <PaneBody {...sections} />
      </div>
      {footer ? <div data-pane-footer="" className="shrink-0 border-t border-hairline px-ops-4 py-ops-3">{footer}</div> : null}
    </aside>
  );
}

/** List on the left (keeps 640px), pane on the right. The pair fills the row; no page max-width. */
export function SplitLayout({ list, pane }: { list: ReactNode; pane?: ReactNode }) {
  return (
    <div data-split-layout="" className="ops-split -me-4 flex min-h-0 w-[calc(100%+16px)] shrink-0">
      <div className="ops-split-list min-w-0 flex-1 overflow-auto">{list}</div>
      {pane}
    </div>
  );
}
