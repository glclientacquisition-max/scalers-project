"use client";

import { businessPaneHref } from "@/lib/ops/businessPane";
import { useEffect, useMemo, useState } from "react";
import {
  ATTENTION_VIEWS,
  KIND_LABEL,
  attentionCounts,
  type AttentionItem,
  type AttentionKind,
} from "@/lib/ops/attentionView";
import { callLength, intentLabel, type PaneCall } from "@/lib/ops/businessesView";
import { PageHeader, SplitLayout, SplitPane, StatusPill, EmptyState } from "@/components/ops";
import { ButtonLink } from "@/components/ui/Button";
import "@/styles/ops.css";

type ViewId = "all" | AttentionKind;
const DATE = new Intl.DateTimeFormat("en-KE", { day: "numeric", month: "short", year: "numeric", timeZone: "Africa/Nairobi" });
const day = (iso: string | null) => (iso ? DATE.format(new Date(iso)) : "—");
const STAMP = new Intl.DateTimeFormat("en-KE", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Africa/Nairobi" });
const TONE: Record<AttentionKind, "danger" | "warn" | "neutral"> = {
  overdue: "danger",
  "no-number": "warn",
  "near-limit": "warn",
  quality: "neutral",
  "missed-demand": "warn",
};
const GO: Record<AttentionKind, string> = {
  overdue: "Open invoice",
  "no-number": "Open business",
  "near-limit": "Open billing",
  quality: "Open quality",
  "missed-demand": "Open insights",
};

/** Needs attention (ADMIN_V2). One row per problem, worst first. Read-only. */
export function AdminAttentionV2({
  items,
  unavailable = [],
  callsFixture,
}: {
  items: AttentionItem[];
  /** Reasons whose read failed, so an empty tab is not mistaken for "all clear". */
  unavailable?: AttentionKind[];
  /** Dev fixture only: skips the read. */
  callsFixture?: Record<string, PaneCall[]>;
}) {
  const [view, setView] = useState<ViewId>("all");
  const [sel, setSel] = useState<string | null>(null);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const v = ATTENTION_VIEWS.find((x) => x.id === params.get("view"));
    if (v) setView(v.id);
    const hit = items.find((x) => x.key === params.get("pane"));
    if (hit) setSel(hit.key);
  }, [items]);
  const counts = useMemo(() => attentionCounts(items), [items]);
  const rows = useMemo(() => items.filter((i) => view === "all" || i.kind === view), [items, view]);
  const it = items.find((x) => x.key === sel) ?? null;
  const bid = it?.businessId ?? null;
  const [calls, setCalls] = useState<Record<string, PaneCall[] | "error">>({});
  useEffect(() => {
    if (!bid || calls[bid]) return;
    if (callsFixture) { setCalls((c) => ({ ...c, [bid]: callsFixture[bid] || [] })); return; }
    let live = true;
    fetch(`/api/admin/businesses/${bid}/calls`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((j: { calls: PaneCall[] }) => { if (live) setCalls((c) => ({ ...c, [bid]: j.calls })); })
      .catch(() => { if (live) setCalls((c) => ({ ...c, [bid]: "error" })); });
    return () => { live = false; };
  }, [bid, calls, callsFixture]);
  const paneCalls = bid ? calls[bid] : undefined;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!sel || (e.target as HTMLElement)?.closest("input,textarea,select")) return;
      if (e.key !== "j" && e.key !== "k") return;
      const i = rows.findIndex((r) => r.key === sel);
      const next = rows[Math.min(rows.length - 1, Math.max(0, i + (e.key === "j" ? 1 : -1)))];
      if (next) setSel(next.key);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [rows, sel]);

  const missing = view === "all" ? unavailable : unavailable.filter((k) => k === view);
  const list = (
    <div className="flex min-h-0 flex-col pe-ops-4">
      <PageHeader title="Needs attention" count={items.length} />
      <div role="tablist" aria-label="Reasons" className="flex flex-wrap gap-1 pb-ops-3">
        {ATTENTION_VIEWS.map((v) => (
          <button
            key={v.id}
            role="tab"
            type="button"
            aria-selected={view === v.id}
            onClick={() => setView(v.id)}
            className={[
              "inline-flex h-ops-touch items-center gap-1.5 rounded-sm px-ops-3 text-ops-body md:h-8",
              view === v.id ? "bg-surface-2 font-semibold text-ink" : "text-ink-2 hover:bg-surface-2",
            ].join(" ")}
          >
            {v.label}
            <span className="tabular-nums text-ink-2">{counts[v.id]}</span>
          </button>
        ))}
      </div>
      {missing.length ? (
        <p className="pb-ops-3 text-ops-label text-ink-2" data-unavailable="">
          Could not check {missing.map((k) => KIND_LABEL[k].toLowerCase()).join(" or ")} right now. Those rows may be missing.
        </p>
      ) : null}
      {rows.length === 0 ? (
        <EmptyState title={missing.length ? "Nothing found that could be checked." : "Nothing needs attention here."} />
      ) : (
        <>
          <ul className="divide-y divide-hairline bg-surface md:hidden" data-phone-rows="">
            {rows.map((r) => (
              <li key={r.key}>
                <button type="button" onClick={() => setSel(r.key)} className="flex min-h-ops-touch w-full flex-col items-start gap-0.5 px-ops-3 py-2 text-start">
                  <span className="flex w-full items-center justify-between gap-2">
                    <span className="min-w-0 truncate text-ink">{r.businessName}</span>
                    <StatusPill tone={TONE[r.kind]}>{KIND_LABEL[r.kind]}</StatusPill>
                  </span>
                  <span className="text-ops-label text-ink-2">{r.detail}</span>
                </button>
              </li>
            ))}
          </ul>
          <table className="hidden w-full whitespace-nowrap text-ops-body md:table" data-attention-table="">
            <thead className="sticky top-0 bg-canvas text-ops-label text-ink-2">
              <tr className="h-ops-row border-b border-hairline">
                <th className="px-ops-3 text-start font-normal">Business</th>
                <th className="px-ops-3 text-start font-normal">Reason</th>
                <th className="px-ops-3 text-start font-normal">Detail</th>
                <th className="px-ops-3 text-end font-normal">Since</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-hairline bg-surface">
              {rows.map((r) => (
                <tr
                  key={r.key}
                  aria-selected={sel === r.key}
                  onClick={() => setSel(r.key)}
                  className={["h-ops-row cursor-pointer", sel === r.key ? "bg-accent/10" : "hover:bg-surface-2"].join(" ")}
                >
                  <td className="max-w-[14rem] truncate px-ops-3 text-ink">
                    <button type="button" className="text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand">{r.businessName}</button>
                  </td>
                  <td className="px-ops-3"><StatusPill tone={TONE[r.kind]}>{KIND_LABEL[r.kind]}</StatusPill></td>
                  <td className="max-w-[22rem] truncate px-ops-3 tabular-nums text-ink-2">{r.detail}</td>
                  <td className="px-ops-3 text-end tabular-nums text-ink-2">{day(r.since)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );

  const others = it ? items.filter((x) => x.businessId === it.businessId && x.key !== it.key) : [];
  return (
    <div className="ops-theme flex min-h-0 w-full flex-col">
      <SplitLayout
        list={list}
        pane={
          <SplitPane
            open={!!it}
            onClose={() => setSel(null)}
            title={it?.businessName || ""}
            facts={it ? [
              { label: "Reason", value: <StatusPill tone={TONE[it.kind]}>{KIND_LABEL[it.kind]}</StatusPill> },
              ...(it.facts.length > 1 ? [] : [{ label: "Detail", value: it.detail }]),
              ...it.facts,
              ...(it.since ? [{ label: "Since", value: day(it.since) }] : []),
            ] : undefined}
            history={it ? [
              ...others.map((o) => ({ when: `Also ${KIND_LABEL[o.kind].toLowerCase()}`, what: o.detail })),
              ...(Array.isArray(paneCalls)
                ? paneCalls.map((c) => ({ when: STAMP.format(new Date(c.created_at)), what: `${intentLabel(c.primary_intent)} · ${callLength(c.duration_seconds)}` }))
                : [{ when: "Calls", what: paneCalls === "error" ? "Could not load calls" : "Loading…" }]),
            ] : undefined}
            related={it ? [
              { label: "Business", href: businessPaneHref(it.businessId) },
              { label: "Invoices", href: `/admin/billing/invoices?business=${it.businessId}` },
              { label: "Call quality", href: businessPaneHref(it.businessId, "calls") },
            ] : undefined}
            footer={it ? (
              <div className="flex w-full items-center justify-between gap-2">
                <span className="text-ops-label text-ink-2">Fixes happen on the linked page.</span>
                <ButtonLink href={it.href} variant="primary" size="md">{GO[it.kind]}</ButtonLink>
              </div>
            ) : undefined}
          />
        }
      />
    </div>
  );
}
