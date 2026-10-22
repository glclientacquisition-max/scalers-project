"use client";

import { businessPaneHref } from "@/lib/ops/businessPane";
import { useEffect, useMemo, useState } from "react";
import {
  NUMBER_VIEWS,
  defaultNumberView,
  formatE164,
  inNumberView,
  isHeld,
  matchesNumber,
  numberCounts,
  numberTone,
  statusLabel,
  type NumberRow,
  type NumberView,
  type WaitingBusiness,
} from "@/lib/ops/numbersView";
import { PageHeader, SplitLayout, SplitPane, StatusPill, EmptyState } from "@/components/ops";
import "@/styles/ops.css";

const DATE = new Intl.DateTimeFormat("en-KE", { day: "numeric", month: "short", year: "numeric", timeZone: "Africa/Nairobi" });
const day = (iso: string | null) => (iso ? DATE.format(new Date(iso)) : "—");

/** Numbers as a table plus pane (ADMIN_V2). Read-only: assign and release wait for step-up codes. */
export function AdminNumbersV2({ rows: all, waiting, nowIso }: { rows: NumberRow[]; waiting: WaitingBusiness[]; nowIso: string }) {
  const now = useMemo(() => new Date(nowIso), [nowIso]);
  const [view, setView] = useState<NumberView>(() => defaultNumberView(all, waiting.length, now));
  const [query, setQuery] = useState("");
  const [sel, setSel] = useState<string | null>(null);
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const v = NUMBER_VIEWS.find((x) => x.id === p.get("view"));
    if (v) setView(v.id);
    const hit = all.find((x) => x.id === p.get("pane"));
    if (hit) {
      setSel(hit.id);
      if (!v) setView(NUMBER_VIEWS.find((x) => x.id !== "all" && inNumberView(hit, x.id, now))?.id ?? "all");
    }
  }, [all, now]);
  const counts = useMemo(() => numberCounts(all, now), [all, now]);
  const rows = useMemo(
    () => all.filter((r) => (query.trim() ? true : inNumberView(r, view, now)) && matchesNumber(r, query)),
    [all, view, query, now],
  );
  const it = all.find((x) => x.id === sel) ?? null;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!sel || (e.target as HTMLElement)?.closest("input,textarea,select")) return;
      if (e.key !== "j" && e.key !== "k") return;
      const i = rows.findIndex((r) => r.id === sel);
      const next = rows[Math.min(rows.length - 1, Math.max(0, i + (e.key === "j" ? 1 : -1)))];
      if (next) setSel(next.id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [rows, sel]);

  const freeingNext = useMemo(
    () => all.filter((r) => isHeld(r, now) && r.holdUntil).sort((a, b) => a.holdUntil!.localeCompare(b.holdUntil!)),
    [all, now],
  );
  const who = (r: NumberRow) =>
    r.businessName ?? (isHeld(r, now) && r.lastBusinessName ? `Was ${r.lastBusinessName}` : "—");

  const list = (
    <div className="flex min-h-0 flex-col pe-ops-4">
      <PageHeader
        title="Numbers"
        count={all.length}
        actions={
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Number or business"
            aria-label="Search numbers"
            className="ops-field w-full min-w-0 text-ink md:w-72"
          />
        }
      />
      <div className="flex flex-wrap items-center gap-2 pb-ops-3">
        <div role="tablist" aria-label="Views" className="flex flex-wrap gap-1">
          {NUMBER_VIEWS.map((v) => (
            <button
              key={v.id}
              role="tab"
              type="button"
              aria-selected={view === v.id && !query.trim()}
              onClick={() => { setView(v.id); setQuery(""); }}
              className={[
                "inline-flex h-ops-touch items-center gap-1.5 rounded-sm px-ops-3 text-ops-body md:h-8",
                view === v.id && !query.trim() ? "bg-surface-2 font-semibold text-ink" : "text-ink-2 hover:bg-surface-2",
              ].join(" ")}
            >
              {v.label}
              <span className="tabular-nums text-ink-2">{counts[v.id]}</span>
            </button>
          ))}
        </div>
        {waiting.length ? (
          <p className="text-ops-body text-ink md:ms-auto" data-waiting="" title={waiting.map((w) => `${w.name} since ${day(w.since)}`).join(" · ")}>
            <span className="font-semibold">{waiting.length === 1 ? "1 business waiting for a number" : `${waiting.length} businesses waiting for a number`}</span>
            <span className="text-ink-2"> · oldest {waiting[0].name}, since {day(waiting[0].since)}</span>
          </p>
        ) : null}
      </div>
      {rows.length === 0 ? (
        <EmptyState title={query.trim() ? "No number matches." : "Nothing in this view."} />
      ) : (
        <>
          <ul className="divide-y divide-hairline bg-surface md:hidden" data-phone-rows="">
            {rows.map((r) => (
              <li key={r.id}>
                <button type="button" onClick={() => setSel(r.id)} className="flex min-h-ops-touch w-full flex-col items-start gap-0.5 px-ops-3 py-2 text-start">
                  <span className="flex w-full items-center justify-between gap-2">
                    <span className="tabular-nums text-ink">{formatE164(r.e164)}</span>
                    <StatusPill tone={numberTone(r, now)}>{statusLabel(r, now)}</StatusPill>
                  </span>
                  <span className="w-full truncate text-ops-label text-ink-2">{who(r)}</span>
                </button>
              </li>
            ))}
          </ul>
          <table className="hidden w-full whitespace-nowrap text-ops-body md:table" data-numbers-table="">
            <thead className="sticky top-0 bg-canvas text-ops-label text-ink-2">
              <tr className="h-ops-row border-b border-hairline">
                <th className="px-ops-3 text-start font-normal">Number</th>
                <th className="px-ops-3 text-start font-normal">Status</th>
                <th className="px-ops-3 text-start font-normal">Business</th>
                <th className="px-ops-3 text-end font-normal">Since</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-hairline bg-surface">
              {rows.map((r) => (
                <tr
                  key={r.id}
                  aria-selected={sel === r.id}
                  onClick={() => setSel(r.id)}
                  className={["h-ops-row cursor-pointer", sel === r.id ? "bg-accent/10" : "hover:bg-surface-2"].join(" ")}
                >
                  <td className="px-ops-3 tabular-nums text-ink">
                    <button type="button" className="text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand">{formatE164(r.e164)}</button>
                  </td>
                  <td className="px-ops-3"><StatusPill tone={numberTone(r, now)}>{statusLabel(r, now)}</StatusPill></td>
                  <td className="max-w-[14rem] truncate px-ops-3 text-ink-2">{who(r)}</td>
                  <td className="px-ops-3 text-end tabular-nums text-ink-2">{day(r.assignedAt ?? r.heldAt ?? r.createdAt)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="sticky bottom-0 bg-surface-2 text-ops-body font-semibold text-ink">
              <tr className="h-ops-row border-t border-hairline">
                <td className="px-ops-3" colSpan={4}>{rows.length} in view · {counts.available} available · {counts.assigned} assigned</td>
              </tr>
            </tfoot>
          </table>
        </>
      )}
    </div>
  );

  return (
    <div className="ops-theme flex min-h-0 w-full flex-col">
      <SplitLayout
        list={list}
        pane={
          <SplitPane
            open={!!it}
            onClose={() => setSel(null)}
            title={it ? formatE164(it.e164) : ""}
            facts={it ? [
              { label: "Status", value: <StatusPill tone={numberTone(it, now)}>{statusLabel(it, now)}</StatusPill> },
              { label: "Business", value: it.businessName ?? "None" },
              ...(it.businessId ? [{ label: "Business live", value: it.businessActive === false ? "Paused" : "Yes" }] : []),
              { label: "Assigned", value: day(it.assignedAt) },
              ...(it.status === "quarantine" ? [{ label: "Held until", value: day(it.holdUntil) }] : []),
              ...(it.lastBusinessName ? [{ label: "Last business", value: it.lastBusinessName }] : []),
              { label: "Added", value: day(it.createdAt) },
              ...(it.notes ? [{ label: "Notes", value: it.notes }] : []),
            ] : undefined}
            history={it ? [
              ...(it.assignedAt ? [{ when: day(it.assignedAt), what: `Assigned to ${it.businessName ?? "a business"}` }] : []),
              ...(it.heldAt ? [{ when: day(it.heldAt), what: `Put on hold${it.lastBusinessName ? ` after ${it.lastBusinessName}` : ""}` }] : []),
              { when: day(it.createdAt), what: "Added to the pool" },
            ] : undefined}
            related={it ? [
              ...(it.businessId ? [{ label: "Business", href: businessPaneHref(it.businessId) }] : []),
              ...(it.lastBusinessId && it.lastBusinessId !== it.businessId ? [{ label: "Last business", href: businessPaneHref(it.lastBusinessId) }] : []),
              ...waiting.slice(0, 5).map((w) => ({ label: `Waiting: ${w.name}`, href: businessPaneHref(w.id), meta: `since ${day(w.since)}` })),
              ...freeingNext.filter((r) => r.id !== it.id).slice(0, 10).map((r) => ({ label: `Frees next: ${formatE164(r.e164)}`, href: `/admin/numbers?pane=${r.id}`, meta: day(r.holdUntil) })),
            ] : undefined}
            footer={it ? (
              <span className="text-ops-label text-ink-2">Assign and release need a fresh code; they arrive with step-up.</span>
            ) : undefined}
          />
        }
      />
    </div>
  );
}
