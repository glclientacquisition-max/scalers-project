"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import type { AdminBusiness } from "@/lib/admin";
import type { QualityBadge } from "@/lib/adminQualityModel";
import { formatScore } from "@/lib/adminQualityModel";
import { statusLabel } from "@/lib/adminBusinessUi";
import { businessTone, callLength, chargingLabel, intentLabel, numberLabel } from "@/lib/ops/businessesView";
import { ksh } from "@/lib/ops/invoicesView";
import { BUSINESS_PANE_SECTIONS, usedShare, type BusinessPaneData, type BusinessPaneSection } from "@/lib/ops/businessPane";
import { OpsConfirm, SplitPane, StatusPill } from "@/components/ops";
import { Button } from "@/components/ui/Button";
import { ARCHIVE_RESTORE_DAYS } from "@/lib/adminBusinessModel";
import { postJson } from "@/lib/ops/archiveRelease";

const DATE = new Intl.DateTimeFormat("en-KE", { day: "numeric", month: "short", year: "numeric", timeZone: "Africa/Nairobi" });
const day = (iso: string | null | undefined) => (iso ? DATE.format(new Date(iso)) : "—");
const STAMP = new Intl.DateTimeFormat("en-KE", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Africa/Nairobi" });
const stamp = (iso: string) => STAMP.format(new Date(iso));

type Loaded = BusinessPaneData & { business: AdminBusiness };

function Facts({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[minmax(7rem,auto)_1fr] gap-x-ops-4 gap-y-ops-1 text-ops-body">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-ink-2">{k}</dt>
          <dd className="min-w-0 tabular-nums text-ink">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function Go({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} className="inline-flex min-h-ops-touch items-center text-ops-body text-accent-deep underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand md:min-h-ops-row">
      {children}
    </a>
  );
}

const Missing = ({ what }: { what: string }) => <p className="text-ops-body text-ink-2">Could not load {what}.</p>;

/**
 * The one business pane (locked 23 Oct, t179u). Same sections in the same order from every entry point;
 * `section` only scrolls one into view. Read-only: actions return with step-up codes (slice 6).
 * Desktop: split pane. Phone: bottom sheet (SplitPane does both).
 */
export function BusinessPane({
  businessId,
  seed,
  badge,
  section = "summary",
  onClose,
  fixture,
}: {
  businessId: string | null;
  /** The list row, so the header shows at once. */
  seed?: AdminBusiness | null;
  badge?: QualityBadge;
  section?: BusinessPaneSection;
  onClose: () => void;
  /** Dev fixture only: skips the read. */
  fixture?: Record<string, Loaded>;
}) {
  const [data, setData] = useState<Record<string, Loaded | "error">>({});
  useEffect(() => {
    if (!businessId || data[businessId]) return;
    if (fixture) { setData((d) => ({ ...d, [businessId]: fixture[businessId] ?? "error" })); return; }
    let live = true;
    fetch(`/api/admin/businesses/${businessId}/pane`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((j: Loaded) => { if (live) setData((d) => ({ ...d, [businessId]: j })); })
      .catch(() => { if (live) setData((d) => ({ ...d, [businessId]: "error" })); });
    return () => { live = false; };
  }, [businessId, data, fixture]);

  const got = businessId ? data[businessId] : undefined;
  const loaded = got && got !== "error" ? got : null;
  const b = loaded?.business ?? seed ?? null;
  const body = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState<BusinessPaneSection>(section);
  useEffect(() => { setActive(section); }, [section, businessId]);
  useEffect(() => {
    if (!businessId) return;
    const el = body.current?.querySelector(`[data-pane-section="${active}"]`);
    if (el && "scrollIntoView" in el) (el as HTMLElement).scrollIntoView({ block: "start" });
  }, [active, businessId, loaded]);

  const pending = got === undefined;
  const failed = got === "error";
  const wait = (what: string, node: ReactNode) => (pending ? <p className="text-ops-body text-ink-2">Loading…</p> : failed ? <Missing what={what} /> : node);

  const u = loaded?.usage ?? null;
  const m = loaded?.money ?? null;
  const share = usedShare(u);
  const blocks: Record<BusinessPaneSection, ReactNode> = {
    summary: b ? (
      <Facts rows={[
        ["Status", <StatusPill key="s" tone={businessTone(b.status)}>{statusLabel(b.status)}</StatusPill>],
        ["Package", b.package_name ? `${b.package_name}${b.package_period ? ` · ${b.package_period === "year" ? "yearly" : "monthly"}` : ""}` : "No package"],
        ["Charging", chargingLabel(b)],
        ["Owner alerts", b.whatsapp_notification_number || "Not set"],
        ["Since", day(b.created_at)],
        ...(b.archived_at ? [["Archived", day(b.archived_at)] as [string, ReactNode]] : []),
      ]} />
    ) : null,
    usage: wait("usage", u ? (
      <>
        <Facts rows={[
          ["Minutes used", u.minutesIncluded ? `${u.minutesUsed} of ${u.minutesIncluded}${share != null ? ` · ${share}%` : ""}` : `${u.minutesUsed}`],
          ["Left", u.minutesIncluded ? String(u.minutesRemaining) : "No package minutes"],
          ["Period ends", u.periodEndLabel || "—"],
          ["On-demand", u.onDemand ? "On" : "Off"],
        ]} />
        {b ? <Go href={`/admin/businesses/${b.id}/usage`}>Usage by day</Go> : null}
      </>
    ) : <p className="text-ops-body text-ink-2">No package this period.</p>),
    money: wait("money", m ? (
      <>
        <Facts rows={[
          ["Balance", ksh(m.balanceCents)],
          ["Open invoices", `${m.openCount}${m.overdueCount ? ` · ${m.overdueCount} overdue` : ""}`],
          ["Last paid", m.lastPaidAt ? day(m.lastPaidAt) : "Never"],
          ["Latest invoice", m.lastInvoice ? m.lastInvoice.number : "None yet"],
          ["Billing", u?.statusLabel || "—"],
        ]} />
        {b ? <Go href={`/admin/billing/invoices?business=${b.id}`}>Invoices for this business</Go> : null}
        <p className="text-ops-label text-ink-2">Package change, minutes and charging move here with step-up codes.</p>
      </>
    ) : null),
    number: b ? (
      <>
        <Facts rows={[["Number", numberLabel(b)]]} />
        <Go href={`/admin/numbers?business=${b.id}`}>Open in Numbers</Go>
      </>
    ) : null,
    calls: (
      <>
        <Facts rows={[["Quality", badge ? `${formatScore(badge.score)}${badge.dropping ? " · dropping" : ""}` : "Not logged"]]} />
        {wait("calls", loaded?.calls?.length ? (
          <ol className="flex flex-col text-ops-body">
            {loaded.calls.map((c) => (
              <li key={c.id}>
                <a href={`/admin/quality/call/${c.id}`} className="grid min-h-ops-touch grid-cols-[7.5rem_1fr] items-center gap-ops-3 rounded-sm hover:bg-surface-2 md:min-h-ops-row">
                  <span className="tabular-nums text-ink-2">{stamp(c.created_at)}</span>
                  <span className="min-w-0 truncate text-ink">{intentLabel(c.primary_intent)} · {callLength(c.duration_seconds)}</span>
                </a>
              </li>
            ))}
          </ol>
        ) : <p className="text-ops-body text-ink-2">No calls yet.</p>)}
        {b ? <Go href={`/admin/quality?pane=${b.id}`}>All calls and quality</Go> : null}
      </>
    ),
    history: wait("history", (
      <ol className="flex flex-col text-ops-body">
        {(loaded?.audit ?? []).map((a) => (
          <li key={a.id} className="grid min-h-ops-row grid-cols-[7.5rem_1fr] items-center gap-ops-3 border-b border-hairline last:border-b-0">
            <span className="tabular-nums text-ink-2">{stamp(a.when)}</span>
            <span className="min-w-0 text-ink">{a.action}<span className="text-ink-2"> · {a.actor}</span></span>
          </li>
        ))}
        {b?.archived_at ? <li className="grid min-h-ops-row grid-cols-[7.5rem_1fr] items-center gap-ops-3"><span className="tabular-nums text-ink-2">{day(b.archived_at)}</span><span>Archived</span></li> : null}
        {b ? <li className="grid min-h-ops-row grid-cols-[7.5rem_1fr] items-center gap-ops-3"><span className="tabular-nums text-ink-2">{day(b.created_at)}</span><span>Signed up</span></li> : null}
      </ol>
    )),
  };

  const [archiving, setArchiving] = useState(false);
  const [archivePending, setArchivePending] = useState(false);
  const [archiveError, setArchiveError] = useState("");
  const [archived, setArchived] = useState(false);
  async function archive(reason: string) {
    if (!businessId) return;
    setArchivePending(true);
    setArchiveError("");
    const r = await postJson("/api/admin/businesses", { action: "archive", business_id: businessId, reason });
    setArchivePending(false);
    if (!r.ok) { setArchiveError(r.error || "Could not archive. Nothing changed."); return; }
    setArchiving(false);
    setArchived(true);
    setData((d) => { const n = { ...d }; delete n[businessId]; return n; });
  }
  const canArchive = Boolean(b) && !b?.archived_at && !archived;
  const footer = b ? (
    <div className="flex flex-col gap-2">
      {archived ? <p className="text-ops-body text-ink-2" role="status">Archived. Restore within {ARCHIVE_RESTORE_DAYS} days.</p> : null}
      {archiveError && !archiving ? <p className="text-ops-body text-attention" role="alert">{archiveError}</p> : null}
      {canArchive ? (
        <div><Button type="button" variant="ghost" size="sm" data-action="archive" onClick={() => { setArchiveError(""); setArchiving(true); }}>Archive</Button></div>
      ) : null}
    </div>
  ) : undefined;

  return (
    <>
    <SplitPane open={!!businessId} onClose={onClose} title={b?.business_name || (businessId ? "Business" : "")} footer={footer}>
      <div ref={body} data-business-pane="">
        <nav aria-label="Sections" className="sticky top-0 z-10 -mx-ops-4 -mt-ops-3 mb-ops-2 flex gap-1 overflow-x-auto border-b border-hairline bg-surface px-ops-4">
          {BUSINESS_PANE_SECTIONS.map((s) => (
            <button
              key={s.id}
              type="button"
              aria-current={active === s.id ? "true" : undefined}
              onClick={() => setActive(s.id)}
              className={["inline-flex h-ops-touch shrink-0 items-center border-b-2 px-2 text-ops-label md:h-9", active === s.id ? "border-accent font-semibold text-ink" : "border-transparent text-ink-2 hover:text-ink"].join(" ")}
            >
              {s.label}
            </button>
          ))}
        </nav>
        <div className="flex flex-col divide-y divide-hairline">
          {BUSINESS_PANE_SECTIONS.map((s) => (
            <section key={s.id} data-pane-section={s.id} className="flex scroll-mt-12 flex-col gap-ops-2 py-ops-3">
              <h3 className="text-ops-label font-semibold uppercase tracking-wide text-ink-2">{s.label}</h3>
              {blocks[s.id]}
            </section>
          ))}
        </div>
      </div>
    </SplitPane>
    <OpsConfirm
      open={archiving && !!businessId}
      onClose={() => { if (!archivePending) setArchiving(false); }}
      onConfirm={(reason) => { void archive(reason); }}
      title="Archive this business?"
      strength="destructive"
      requireReason
      confirmLabel="Archive business"
      pending={archivePending}
    >
      {archiveError ? <p className="pb-2 text-attention" role="alert">{archiveError}</p> : null}
      <p>{b?.business_name ?? "This business"}: the line closes, charging stops and the owner can&apos;t sign in. You can restore it within {ARCHIVE_RESTORE_DAYS} days. Its number stays assigned until you release it on Numbers.</p>
    </OpsConfirm>
    </>
  );
}
