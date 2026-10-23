"use client";

import { useMemo, useState } from "react";
import type { PackageVersionCatalog, PackageVersionRow, VersionPackage } from "@/lib/packageVersionCatalog";
import { EmptyState, PageHeader, SplitLayout, SplitPane, StatusPill, type OpsTone, UnlockCta } from "@/components/ops";
import "@/styles/ops.css";

const ksh = (n: number) => `KSh ${n.toLocaleString("en-KE")}`;

function statusTone(s: PackageVersionRow["status"]): OpsTone {
  return s === "published" ? "ok" : s === "draft" ? "warn" : "neutral";
}

type Flat = { pack: VersionPackage; version: PackageVersionRow; key: string };

/**
 * Packages (ADMIN_V2): versions as an ops table + pane. View-only when the editor is off,
 * or Unlock-gated until step-up. 
 */
export function AdminPackagesV2({
  catalog,
  readOnlyHint,
  initialSel = null,
}: {
  catalog: PackageVersionCatalog;
  readOnlyHint: string | null;
  /** Dev fixture: open a row so the pane fills the blank-band region. */
  initialSel?: string | null;
}) {
  const [sel, setSel] = useState<string | null>(initialSel);
  const rows: Flat[] = useMemo(
    () =>
      catalog.packages.flatMap((pack) =>
        pack.versions.map((version) => ({ pack, version, key: `${pack.id}:${version.id}` })),
      ),
    [catalog],
  );
  const it = rows.find((r) => r.key === sel) ?? null;
  const published = rows.filter((r) => r.version.status === "published").length;

  const list = (
    <div className="flex min-h-0 flex-col">
      <PageHeader
        title="Packages"
        count={rows.length}
        actions={
          <UnlockCta
            site="packages"
            action="packages:edit"
            what="draft or publish packages"
            observedHint="Draft and publish land with the Packages remake. Observe only logged the gate."
          />
        }
      />
      <p className="pb-ops-2 text-ops-label text-ink-2">
        <span className="font-semibold text-ink">{published} published</span>
        {" · "}
        {catalog.packageEditorEnabled ? "Editor on" : "Editor off"}
        {" · View only · unlock to change"}
        {readOnlyHint ? <span className="ms-1">· {readOnlyHint}</span> : null}
      </p>
            {rows.length === 0 ? (
        <EmptyState title="No packages yet." />
      ) : (
        <>
          <ul className="divide-y divide-hairline bg-surface md:hidden">
            {rows.map((r) => (
              <li key={r.key}>
                <button type="button" onClick={() => setSel(r.key)} className="flex min-h-ops-touch w-full flex-col gap-0.5 px-ops-3 py-2 text-start">
                  <span className="flex justify-between gap-2">
                    <span className="truncate font-semibold text-ink">{r.pack.name} v{r.version.version}</span>
                    <StatusPill tone={statusTone(r.version.status)}>{r.version.status}</StatusPill>
                  </span>
                  <span className="text-ops-label text-ink-2">{ksh(r.version.monthlyPriceKes)}/mo · {r.version.minutes} min · {r.version.subscriberCount} on it</span>
                </button>
              </li>
            ))}
          </ul>
          <table className="hidden w-full text-ops-body md:table">
            <thead className="sticky top-0 bg-canvas text-ops-label text-ink-2">
              <tr className="h-ops-row border-b border-hairline">
                <th className="px-ops-3 text-start font-normal">Package</th>
                <th className="px-ops-3 text-start font-normal">Status</th>
                <th className="px-ops-3 text-end font-normal">Monthly</th>
                <th className="px-ops-3 text-end font-normal">Annual</th>
                <th className="px-ops-3 text-end font-normal">Minutes</th>
                <th className="px-ops-3 text-end font-normal">Seats</th>
                <th className="px-ops-3 text-end font-normal">On it</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-hairline bg-surface">
              {rows.map((r) => (
                <tr key={r.key} aria-selected={sel === r.key} onClick={() => setSel(r.key)} className={["h-ops-row cursor-pointer", sel === r.key ? "bg-accent/10" : "hover:bg-surface-2"].join(" ")}>
                  <td className="px-ops-3 text-ink"><span className="font-semibold">{r.pack.name}</span> <span className="text-ink-2">v{r.version.version}</span></td>
                  <td className="px-ops-3"><StatusPill tone={statusTone(r.version.status)}>{r.version.status}</StatusPill></td>
                  <td className="px-ops-3 text-end tabular-nums text-ink">{ksh(r.version.monthlyPriceKes)}</td>
                  <td className="px-ops-3 text-end tabular-nums text-ink-2">{ksh(r.version.annualPriceKes)}</td>
                  <td className="px-ops-3 text-end tabular-nums text-ink-2">{r.version.minutes}</td>
                  <td className="px-ops-3 text-end tabular-nums text-ink-2">{r.version.seats}</td>
                  <td className="px-ops-3 text-end tabular-nums text-ink-2">{r.version.subscriberCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );

  const v = it?.version;
  return (
    <div className="ops-theme flex min-h-0 w-full flex-col">
      <SplitLayout
        list={list}
        pane={
          <SplitPane
            open={!!it}
            onClose={() => setSel(null)}
            title={it ? `${it.pack.name} v${it.version.version}` : ""}
            facts={v ? [
              { label: "Status", value: <StatusPill tone={statusTone(v.status)}>{v.status}</StatusPill> },
              { label: "Monthly", value: ksh(v.monthlyPriceKes) },
              { label: "Annual", value: ksh(v.annualPriceKes) },
              { label: "Minutes", value: String(v.minutes) },
              { label: "Seats", value: String(v.seats) },
              { label: "Numbers", value: String(v.dids) },
              { label: "On this version", value: String(v.subscriberCount) },
              { label: "Trial days", value: v.trialDays == null ? "Not set" : String(v.trialDays) },
              { label: "Features", value: v.features.filter((f) => f.enabled).map((f) => f.label).join(", ") || "None" },
            ] : undefined}
            footer={<span className="text-ops-label text-ink-2">Publishing and price edits wait for step-up.</span>}
          />
        }
      />
    </div>
  );
}
