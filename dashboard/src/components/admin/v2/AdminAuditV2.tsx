"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { activityHref, type ActivityItem } from "@/lib/adminActivityModel";
import { EmptyState, PageHeader, SplitLayout, SplitPane } from "@/components/ops";
import "@/styles/ops.css";

/**
 * Audit log (ADMIN_V2): change-record density like Businesses.
 * Desktop rows keyboardable (tabIndex + Enter/Space + j/k). Read-only.
 */
export function AdminAuditV2({
  items,
  businesses,
  actors,
  business,
  actor,
  limit,
  initialSel = null,
}: {
  items: ActivityItem[];
  businesses: { id: string; name: string }[];
  actors: string[];
  business: string | null;
  actor: string | null;
  limit: number;
  /** Dev fixture: open a row so the pane fills the blank-band region. */
  initialSel?: string | null;
}) {
  const router = useRouter();
  const [sel, setSel] = useState<string | null>(initialSel);
  const it = items.find((i) => i.id === sel) ?? null;
  const bizName = (id: string | null) => (id ? businesses.find((b) => b.id === id)?.name : null);
  const go = (next: { business?: string | null; actor?: string | null }) =>
    router.replace(activityHref({ business, actor, ...next }).replace("/admin/activity", "/admin/settings/audit"), { scroll: false });

  const filters = useMemo(() => {
    const bits: string[] = [];
    if (business) bits.push(bizName(business) || "Business");
    if (actor) bits.push(actor);
    return bits.length ? bits.join(" · ") : "All";
  }, [business, actor, businesses]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!sel || (e.target as HTMLElement)?.closest("input,textarea,select")) return;
      if (e.key !== "j" && e.key !== "k") return;
      const i = items.findIndex((r) => r.id === sel);
      if (i < 0) return;
      const next = items[Math.min(items.length - 1, Math.max(0, i + (e.key === "j" ? 1 : -1)))];
      if (next) setSel(next.id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [items, sel]);

  const list = (
    <div className="flex min-h-0 flex-col pe-ops-4">
      <PageHeader
        title="Audit log"
        count={items.length}
        actions={
          <div className="flex flex-wrap gap-1 text-ops-body">
            <label className="inline-flex h-8 items-center gap-1 text-ink-2">
              Business
              <select
                className="ops-field h-8 max-w-[10rem]"
                value={business || ""}
                onChange={(e) => go({ business: e.target.value || null })}
                aria-label="Filter by business"
              >
                <option value="">All</option>
                {businesses.map((b) => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
            </label>
            <label className="inline-flex h-8 items-center gap-1 text-ink-2">
              Operator
              <select
                className="ops-field h-8 max-w-[8rem]"
                value={actor || ""}
                onChange={(e) => go({ actor: e.target.value || null })}
                aria-label="Filter by operator"
              >
                <option value="">Everyone</option>
                {actors.map((a) => (
                  <option key={a} value={a}>{a}</option>
                ))}
              </select>
            </label>
          </div>
        }
      />
      <p className="pb-ops-2 text-ops-label text-ink-2">
        <span className="font-semibold text-ink">{filters}</span> · newest first · showing up to {limit}
        {sel ? " · j/k to move" : null}
      </p>
      {items.length === 0 ? (
        <EmptyState title={business || actor ? "Nothing for this filter." : "No admin actions yet."} />
      ) : (
        <>
          <ul className="divide-y divide-hairline bg-surface md:hidden" data-phone-rows="">
            {items.map((r) => (
              <li key={r.id}>
                <button type="button" onClick={() => setSel(r.id)} className="flex min-h-ops-touch w-full flex-col gap-0.5 px-ops-3 py-2 text-start">
                  <span className="flex justify-between gap-2"><span className="truncate font-semibold text-ink">{r.title}</span><span className="tabular-nums text-ops-label text-ink-2">{r.when}</span></span>
                  <span className="truncate text-ops-label text-ink-2">{r.preview}</span>
                </button>
              </li>
            ))}
          </ul>
          <table className="hidden w-full whitespace-nowrap text-ops-body md:table" data-audit-table="">
            <thead className="sticky top-0 bg-canvas text-ops-label text-ink-2">
              <tr className="h-ops-row border-b border-hairline">
                <th className="px-ops-3 text-start font-normal">When</th>
                <th className="px-ops-3 text-start font-normal">Action</th>
                <th className="px-ops-3 text-start font-normal">Business</th>
                <th className="px-ops-3 text-start font-normal">Operator</th>
                <th className="hidden px-ops-3 text-start font-normal xl:table-cell">Why</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-hairline bg-surface">
              {items.map((r) => (
                <tr
                  key={r.id}
                  aria-selected={sel === r.id}
                  tabIndex={0}
                  role="button"
                  onClick={() => setSel(r.id)}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSel(r.id); } }}
                  className={["h-ops-row cursor-pointer", sel === r.id ? "bg-accent/10" : "hover:bg-surface-2"].join(" ")}
                >
                  <td className="whitespace-nowrap px-ops-3 tabular-nums text-ink-2">
                    <button
                      type="button"
                      className="text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                      onClick={(e) => { e.stopPropagation(); setSel(r.id); }}
                    >
                      {r.when}
                    </button>
                  </td>
                  <td className="max-w-[16rem] truncate px-ops-3 font-semibold text-ink">{r.title}</td>
                  <td className="max-w-[12rem] truncate px-ops-3 text-ink-2">{r.business || "—"}</td>
                  <td className="px-ops-3 text-ink-2">{r.actor}</td>
                  <td className="hidden max-w-[14rem] truncate px-ops-3 text-ink-2 xl:table-cell">{r.reason || "—"}</td>
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
          <SplitPane
            open={!!it}
            onClose={() => setSel(null)}
            title={it?.title || ""}
            facts={it ? [
              { label: "When", value: it.when },
              { label: "Operator", value: it.actor },
              { label: "Business", value: it.business || "—" },
              { label: "Why", value: it.reason || "—" },
            ] : undefined}
            history={it?.changes.map((c) => ({
              when: c.field,
              what: <span className="tabular-nums text-ink-2">{c.before ? `${c.before} → ${c.after}` : c.after}</span>,
            }))}
            related={it?.businessId ? [{ label: "Business", href: `/admin/businesses?pane=${encodeURIComponent(it.businessId)}` }] : undefined}
            footer={it ? <span className="text-ops-label text-ink-2">Audit is read-only. The write already happened.</span> : undefined}
          />
        }
      />
    </div>
  );
}
