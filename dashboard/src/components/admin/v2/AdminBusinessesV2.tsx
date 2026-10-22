"use client";

import { useEffect, useMemo, useState } from "react";
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
  viewCounts,
  callLength,
  intentLabel,
  type BusinessView,
  type PaneCall,
} from "@/lib/ops/businessesView";
import { PageHeader, SplitLayout, SplitPane, StatusPill, EmptyState } from "@/components/ops";
import { ButtonLink } from "@/components/ui/Button";
import "@/styles/ops.css";

const DATE = new Intl.DateTimeFormat("en-KE", { day: "numeric", month: "short", year: "numeric", timeZone: "Africa/Nairobi" });
const day = (iso: string) => (iso ? DATE.format(new Date(iso)) : "—");
const STAMP = new Intl.DateTimeFormat("en-KE", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Africa/Nairobi" });
const stamp = (iso: string) => STAMP.format(new Date(iso));

/** Businesses as a table plus split pane (ADMIN_V2). Read-only: actions stay on the business page until step-up codes land. */
export function AdminBusinessesV2({
  businesses,
  badges = {},
  callsFixture,
}: {
  businesses: AdminBusiness[];
  badges?: Record<string, QualityBadge>;
  /** Dev fixture only: skips the read. */
  callsFixture?: Record<string, PaneCall[]>;
}) {
  const [view, setView] = useState<BusinessView>(() => defaultView(businesses));
  const [query, setQuery] = useState("");
  const [sel, setSel] = useState<string | null>(null);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
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
    () => businesses.filter((b) => (query.trim() ? b.status !== "archived" || view === "archived" : inView(b, view)) && matchesQuery(b, query)),
    [businesses, view, query],
  );
  const b = businesses.find((x) => x.id === sel) ?? null;
  const [calls, setCalls] = useState<Record<string, PaneCall[] | "error">>({});
  useEffect(() => {
    if (!sel || calls[sel]) return;
    if (callsFixture) { setCalls((c) => ({ ...c, [sel]: callsFixture[sel] || [] })); return; }
    let live = true;
    fetch(`/api/admin/businesses/${sel}/calls`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((j: { calls: PaneCall[] }) => { if (live) setCalls((c) => ({ ...c, [sel]: j.calls })); })
      .catch(() => { if (live) setCalls((c) => ({ ...c, [sel]: "error" })); });
    return () => { live = false; };
  }, [sel, calls, callsFixture]);
  const paneCalls = sel ? calls[sel] : undefined;
  const history = b ? [
    ...(Array.isArray(paneCalls) ? paneCalls.map((c) => ({ when: stamp(c.created_at), what: `${intentLabel(c.primary_intent)} · ${callLength(c.duration_seconds)}` })) : []),
    ...(b.archived_at ? [{ when: day(b.archived_at), what: "Archived" }] : []),
    ...(b.suspended_at ? [{ when: day(b.suspended_at), what: "Line suspended" }] : []),
    { when: day(b.created_at), what: "Signed up" },
  ] : undefined;

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
        <div role="tablist" aria-label="Views" className="flex flex-wrap gap-1">
          {BUSINESS_VIEWS.map((v) => (
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
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Name, number or package"
          aria-label="Search businesses"
          className="ops-field ms-auto w-full text-ink md:w-auto md:min-w-0 md:flex-1 md:max-w-64"
        />
      </div>
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
                    <StatusPill tone={businessTone(r.status)}>{statusLabel(r.status)}</StatusPill>
                  </span>
                  <span className="text-ops-label text-ink-2">{r.package_name || "No package"} · {numberLabel(r)}</span>
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
                  <td className="px-ops-3"><StatusPill tone={businessTone(r.status)}>{statusLabel(r.status)}</StatusPill></td>
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

  const badge = b ? badges[b.id] : undefined;
  return (
    <div className="ops-theme flex min-h-0 w-full flex-col">
      <SplitLayout
        list={list}
        pane={
          <SplitPane
            open={!!b}
            onClose={() => setSel(null)}
            title={b?.business_name || ""}
            facts={b ? [
              { label: "Status", value: <StatusPill tone={businessTone(b.status)}>{statusLabel(b.status)}</StatusPill> },
              { label: "Number", value: numberLabel(b) },
              { label: "Package", value: b.package_name ? `${b.package_name}${b.package_period ? ` · ${b.package_period === "year" ? "yearly" : "monthly"}` : ""}` : "No package" },
              { label: "Charging", value: chargingLabel(b) },
              { label: "Owner alerts", value: b.whatsapp_notification_number || "Not set" },
              { label: "Quality", value: badge ? `${formatScore(badge.score)}${badge.dropping ? " · dropping" : ""}` : "Not logged" },
              { label: "Last call", value: Array.isArray(paneCalls) ? (paneCalls[0] ? stamp(paneCalls[0].created_at) : "No calls yet") : paneCalls === "error" ? "Could not load calls" : "Loading…" },
              { label: "Since", value: day(b.created_at) },
              ...(b.archived_at ? [{ label: "Archived", value: day(b.archived_at) }] : []),
            ] : undefined}
            history={history}
            related={b ? [
              { label: "Usage this period", href: `/admin/businesses/${b.id}/usage` },
              { label: "Invoices", href: `/admin/billing/invoices?business=${b.id}` },
              { label: "Billing history", href: `/admin/billing/${b.id}` },
              { label: "Call quality", href: `/admin/quality/${b.id}` },
            ] : undefined}
            footer={b ? (
              <div className="flex w-full items-center justify-between gap-2">
                <span className="text-ops-label text-ink-2">Number, package and lifecycle actions are on the business page.</span>
                <ButtonLink href={`/admin/businesses/${b.id}`} variant="primary" size="md">Open business</ButtonLink>
              </div>
            ) : undefined}
          />
        }
      />
    </div>
  );
}
