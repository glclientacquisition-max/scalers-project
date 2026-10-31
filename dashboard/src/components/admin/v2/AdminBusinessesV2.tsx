"use client";

import { useEffect, useMemo, useState, type ComponentProps } from "react";
import type { AdminBusiness } from "@/lib/admin";
import type { QualityBadge } from "@/lib/adminQualityModel";
import { formatScore } from "@/lib/adminQualityModel";
import { statusLabel } from "@/lib/adminBusinessUi";
import {
  BUSINESS_VIEWS,
  businessTone,
  chargingLabel,
  defaultView,
  inView,
  matchesQuery,
  numberLabel,
  sortBusinesses,
  viewCounts,
  type BusinessView,
} from "@/lib/ops/businessesView";
import { parsePaneSection, type BusinessPaneSection } from "@/lib/ops/businessPane";
import { PageHeader, SplitLayout, StatusPill, EmptyState, Sparkline } from "@/components/ops";
import type { UsageInput } from "@/lib/ops/attentionView";
import { BusinessPane } from "./BusinessPane";
import "@/styles/ops.css";

function scoresOf(badge: QualityBadge | undefined): number[] {
  return badge?.scores && badge.scores.length >= 2 ? badge.scores : [];
}

function UsageBit({ row }: { row?: UsageInput }) {
  if (!row || !(row.includedMinutes > 0)) return null;
  const used = Math.floor(Math.max(0, row.usedSeconds) / 60);
  const fill = Math.max(0, Math.min(1, row.usedSeconds / (row.includedMinutes * 60)));
  return (
    <span className="ms-auto flex shrink-0 items-center gap-1">
      <span className="relative h-1.5 w-14 overflow-hidden rounded-full bg-surface-2" aria-hidden="true">
        <span className="block h-full w-full origin-left bg-accent" style={{ transform: `scaleX(${fill})` }} />
      </span>
      <span className="tabular-nums text-ink">{used} of {row.includedMinutes}</span>
    </span>
  );
}

const DATE = new Intl.DateTimeFormat("en-KE", { day: "numeric", month: "short", year: "numeric", timeZone: "Africa/Nairobi" });
const day = (iso: string) => (iso ? DATE.format(new Date(iso)) : "—");

/** Businesses as a table plus the shared BusinessPane (ADMIN_V2). Read-only until step-up codes land. */
export function AdminBusinessesV2({
  businesses,
  badges = {},
  usage = null,
  paneFixture,
}: {
  businesses: AdminBusiness[];
  badges?: Record<string, QualityBadge>;
  /** Null when the usage read failed. Missing id means that business has no included minutes. */
  usage?: UsageInput[] | null;
  /** Dev fixture only: skips the pane read. */
  paneFixture?: ComponentProps<typeof BusinessPane>["fixture"];
}) {
  const usageById = useMemo(() => {
    const map = new Map<string, UsageInput>();
    for (const row of usage || []) map.set(row.tenantId, row);
    return map;
  }, [usage]);
  const [view, setView] = useState<BusinessView>(() => defaultView(businesses));
  const [query, setQuery] = useState("");
  const [sel, setSel] = useState<string | null>(null);
  const [section, setSection] = useState<BusinessPaneSection>("usage");
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setSection(parsePaneSection(params.get("section")));
    const asked = BUSINESS_VIEWS.find((x) => x.id === params.get("view"));
    if (asked) setView(asked.id);
    const q = params.get("pane");
    const hit = q ? businesses.find((x) => x.id === q) : undefined;
    if (!hit) return;
    setSel(hit.id);
    const v = BUSINESS_VIEWS.find((x) => inView(hit, x.id));
    if (v) setView(v.id);
  }, [businesses]);
  const counts = useMemo(() => viewCounts(businesses), [businesses]);
  const rows = useMemo(
    () => sortBusinesses(businesses.filter((b) => inView(b, view) && matchesQuery(b, query))),
    [businesses, view, query],
  );
  const b = businesses.find((x) => x.id === sel) ?? null;
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

  const list = (
    <div className="flex min-h-0 flex-col pe-ops-4">
      <PageHeader title="Businesses" count={businesses.filter((x) => x.status !== "archived").length} />
      <div className="flex flex-wrap items-center gap-2 pb-ops-3">
        <div role="tablist" aria-label="Views" className="flex w-full gap-1 overflow-x-auto md:w-auto">
          {BUSINESS_VIEWS.map((v) => (
            <button
              key={v.id}
              role="tab"
              type="button"
              aria-selected={view === v.id && !query.trim()}
              onClick={() => { setView(v.id); setQuery(""); }}
              className={[
                "inline-flex h-11 shrink-0 items-center gap-1.5 rounded-xl px-3 text-body md:h-8",
                view === v.id && !query.trim() ? "bg-surface-2 font-semibold text-ink" : "text-ink-2 hover:bg-surface-2",
              ].join(" ")}
            >
              {v.label}
              <span className="tabular-nums text-ink-2">{counts[v.id]}</span>
            </button>
          ))}
        </div>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Name, number or package"
          aria-label="Search businesses"
          className="ops-field ms-auto w-full text-ink md:w-auto md:min-w-0 md:flex-1 md:max-w-64"
        />
      </div>
      {usage == null ? <p className="pb-ops-2 text-ops-label text-ink-2">Could not load usage. Minute bars may be missing.</p> : null}
      {rows.length === 0 ? (
        <EmptyState title={query.trim() ? "No business matches." : "Nothing in this view."} />
      ) : (
        <>
          <ul className="divide-y divide-hairline bg-surface md:hidden" data-phone-rows="">
            {rows.map((r) => (
              <li key={r.id}>
                <button type="button" onClick={() => setSel(r.id)} className="flex min-h-ops-touch w-full flex-col items-start gap-0.5 px-ops-3 py-2 text-start">
                  <span className="flex w-full items-center justify-between gap-2">
                    <span className="min-w-0 truncate text-ink">{r.business_name}</span>
                    {statusLabel(r.status) !== "Active" && !(view === "waiting" && r.status === "waiting") && !(view === "suspended" && r.status === "suspended") ? (
                      <StatusPill tone={businessTone(r.status)}>{statusLabel(r.status)}</StatusPill>
                    ) : null}
                  </span>
                  <span className="flex w-full items-center gap-2 text-ops-label text-ink-2">
                    <span className="min-w-0 truncate">{r.package_name || "No package"}{numberLabel(r) ? ` · ${numberLabel(r)}` : ""}</span>
                    <UsageBit row={usageById.get(r.id)} />
                    {scoresOf(badges[r.id]).length >= 2 ? (
                      <Sparkline points={scoresOf(badges[r.id])} label={`${r.business_name} quality`} />
                    ) : null}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <table className="hidden w-full whitespace-nowrap text-ops-body md:table" data-businesses-table="">
            <thead className="sticky top-0 bg-canvas text-ops-label text-ink-2">
              <tr className="h-ops-row border-b border-hairline">
                <th className="px-ops-3 text-start font-normal">Business</th>
                <th className="px-ops-3 text-start font-normal">Status</th>
                <th className="px-ops-3 text-start font-normal">Package</th>
                <th className="px-ops-3 text-start font-normal">Number</th>
                <th className="px-ops-3 text-start font-normal">Charging</th>
                <th className="px-ops-3 text-end font-normal">Quality</th>
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
                  <td className="max-w-[16rem] truncate px-ops-3 text-ink">
                    <button type="button" className="text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand">{r.business_name}</button>
                  </td>
                  <td className="px-ops-3">{statusLabel(r.status) !== "Active" && !(view === "waiting" && r.status === "waiting") && !(view === "suspended" && r.status === "suspended") ? <StatusPill tone={businessTone(r.status)}>{statusLabel(r.status)}</StatusPill> : null}</td>
                  <td className="px-ops-3 text-ink-2">{r.package_name || "No package"}</td>
                  <td className="px-ops-3 tabular-nums text-ink-2">{numberLabel(r)}</td>
                  <td className="px-ops-3 text-ink-2">{chargingLabel(r)}</td>
                  <td className="px-ops-3 text-end tabular-nums text-ink-2">{badges[r.id] ? formatScore(badges[r.id].score) : "—"}</td>
                  <td className="px-ops-3 text-end tabular-nums text-ink-2">{day(r.created_at)}</td>
                </tr>
              ))}
            </tbody>
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
          <BusinessPane
            businessId={sel}
            seed={b}
            badge={b ? badges[b.id] : undefined}
            section={section}
            onClose={() => setSel(null)}
            fixture={paneFixture}
          />
        }
      />
    </div>
  );
}
