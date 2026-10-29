"use client";

import { useMemo, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { PackageVersionCatalog, PackageVersionRow, VersionPackage } from "@/lib/packageVersionCatalog";
import { requestErrorText } from "@/lib/adminBillingCopy";
import {
  EmptyState,
  PageHeader,
  SplitLayout,
  SplitPane,
  StatusPill,
  UnlockCta,
  Drawer,
  OpsConfirm,
  useAdminUnlockSession,
  type OpsTone,
} from "@/components/ops";
import { Button } from "@/components/ui/Button";
import "@/styles/ops.css";

const ksh = (n: number) => `KSh ${n.toLocaleString("en-KE")}`;
const PAGE_SIZE = 25;

function statusTone(s: PackageVersionRow["status"]): OpsTone {
  return s === "published" ? "ok" : s === "draft" ? "warn" : "neutral";
}

type Flat = { pack: VersionPackage; version: PackageVersionRow; key: string };

type CatalogForm = {
  versionId: string;
  sku: string;
  name: string;
  monthly: string;
  annual: string;
  minutes: string;
  seats: string;
  trialDays: string;
};

function formFrom(pack: VersionPackage, version: PackageVersionRow): CatalogForm {
  return {
    versionId: version.id,
    sku: pack.sku,
    name: pack.name,
    monthly: String(version.monthlyPriceKes),
    annual: String(version.annualPriceKes),
    minutes: String(version.minutes),
    seats: String(version.seats),
    trialDays: version.trialDays == null ? "" : String(version.trialDays),
  };
}

/**
 * Packages catalog (ADMIN_V2): minutes/terms only.
 * Unlock → UnlockCta/StepUpSheet; after observe, draft/publish via /api/admin/package-versions.
 * Assigning a package to a business stays on BusinessPane.
 */
export function AdminPackagesV2({
  catalog,
  readOnlyHint,
  initialSel = null,
}: {
  catalog: PackageVersionCatalog;
  readOnlyHint: string | null;
  initialSel?: string | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [sel, setSel] = useState<string | null>(initialSel);
  const unlockSession = useAdminUnlockSession();
  const [editOpen, setEditOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [form, setForm] = useState<CatalogForm | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const rows: Flat[] = useMemo(
    () =>
      catalog.packages.flatMap((pack) =>
        pack.versions.map((version) => ({ pack, version, key: `${pack.id}:${version.id}` })),
      ),
    [catalog],
  );
  const it = rows.find((r) => r.key === sel) ?? null;
  const publishedCount = rows.filter((r) => r.version.status === "published").length;
  const editorOn = catalog.packageEditorEnabled;
  const unlocked =
    unlockSession.status?.mode !== "enforce" ? true : unlockSession.unlocked;
  const canWrite = unlocked && editorOn;

  const page = Math.max(1, Number.parseInt(searchParams.get("page") || "1", 10) || 1);
  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const pageRows = rows.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  function goPage(next: number) {
    const p = Math.min(pageCount, Math.max(1, next));
    const q = new URLSearchParams(searchParams.toString());
    if (p <= 1) q.delete("page");
    else q.set("page", String(p));
    const qs = q.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname);
  }

  async function post(body: Record<string, unknown>) {
    setError(null);
    if (!editorOn) {
      setError(readOnlyHint || "Plans are read-only here.");
      return null;
    }
    const res = await fetch("/api/admin/package-versions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(requestErrorText(json, "Could not save. Nothing changed."));
      return null;
    }
    return json as Record<string, unknown>;
  }

  function openEdit(pack: VersionPackage, version: PackageVersionRow) {
    if (version.status !== "draft") {
      setError("Only drafts can be edited. Open a draft from the published row first.");
      return;
    }
    setForm(formFrom(pack, version));
    setReason("");
    setError(null);
    setEditOpen(true);
  }

  async function openOrCreateDraft(pack: VersionPackage) {
    const draft = pack.versions.find((v) => v.status === "draft");
    if (draft) {
      openEdit(pack, draft);
      return;
    }
    const json = await post({ action: "draft", sku: pack.sku, reason: `Open a ${pack.name} draft` });
    if (!json) return;
    setStatus(`${pack.name} draft opened.`);
    startTransition(() => router.refresh());
  }

  async function saveDraft() {
    if (!form) return;
    if (!reason.trim()) {
      setError("A reason is required.");
      return;
    }
    const saved = await post({
      action: "update_draft",
      version_id: form.versionId,
      patch: {
        monthly_price_kes: Number(form.monthly),
        annual_price_kes: Number(form.annual),
        minutes: Number(form.minutes),
        seats: Number(form.seats),
        trial_days: form.sku === "trial" ? Number(form.trialDays) || null : null,
      },
      reason: reason.trim(),
    });
    if (!saved) return;
    setStatus("Draft saved.");
    setEditOpen(false);
    startTransition(() => router.refresh());
  }

  async function publishDraft() {
    if (!form) return;
    if (!reason.trim()) {
      setError("A reason is required.");
      return;
    }
    const publishedRes = await post({
      action: "publish",
      version_id: form.versionId,
      active_from: new Date().toISOString(),
      reason: reason.trim(),
    });
    if (!publishedRes) return;
    setStatus(`${form.name} published.`);
    setEditOpen(false);
    startTransition(() => router.refresh());
  }

  async function archiveVersion(reasonText: string) {
    if (!it?.version || !reasonText.trim()) {
      setError("A reason is required.");
      return;
    }
    const archived = await post({
      action: "archive",
      version_id: it.version.id,
      reason: reasonText.trim(),
    });
    if (!archived) return;
    setStatus(`${it.pack.name} archived.`);
    setArchiveOpen(false);
    setSel(null);
    startTransition(() => router.refresh());
  }

  const list = (
    <div className="flex min-h-0 flex-col pe-ops-4">
      <PageHeader
        title="Packages"
        count={rows.length}
        actions={
          <UnlockCta
            site="packages"
            action="packages:edit"
            what="edit package minutes and terms"
            observedHint="Pick a row, then open or edit a draft."
          />
        }
      />
      <p className="pb-ops-2 text-ops-label text-ink-2">
        <span className="font-semibold text-ink">{publishedCount} published</span>
        {" · "}
        {editorOn ? "Editor on" : "Editor off"}
        {readOnlyHint ? <span className="ms-1">· {readOnlyHint}</span> : null}
        {status ? <span className="ms-1 text-ink">· {status}</span> : null}
      </p>
      {error && !editOpen ? (
        <p className="mb-ops-2 text-ops-label text-attention" role="alert">{error}</p>
      ) : null}
      {rows.length === 0 ? (
        <EmptyState title="No packages yet." />
      ) : (
        <>
          <ul className="divide-y divide-hairline bg-surface md:hidden">
            {pageRows.map((r) => (
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
          <table className="hidden w-full whitespace-nowrap text-ops-body md:table" data-packages-table="">
            <thead className="sticky top-0 bg-canvas text-ops-label text-ink-2">
              <tr className="h-ops-row border-b border-hairline">
                <th className="px-ops-3 text-start font-normal">Package</th>
                <th className="px-ops-3 text-start font-normal">Status</th>
                <th className="px-ops-3 text-end font-normal">Monthly</th>
                <th className="px-ops-3 text-end font-normal">Minutes</th>
                <th className="px-ops-3 text-end font-normal">On it</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-hairline bg-surface">
              {pageRows.map((r) => (
                <tr
                  key={r.key}
                  aria-selected={sel === r.key}
                  onClick={() => setSel(r.key)}
                  className={["h-ops-row cursor-pointer", sel === r.key ? "bg-accent/10" : "hover:bg-surface-2"].join(" ")}
                >
                  <td className="px-ops-3 text-ink">
                    <button type="button" className="text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand">
                      <span className="font-semibold">{r.pack.name}</span> <span className="text-ink-2">v{r.version.version}</span>
                    </button>
                  </td>
                  <td className="px-ops-3"><StatusPill tone={statusTone(r.version.status)}>{r.version.status}</StatusPill></td>
                  <td className="px-ops-3 text-end tabular-nums text-ink">{ksh(r.version.monthlyPriceKes)}</td>
                  <td className="px-ops-3 text-end tabular-nums text-ink-2">{r.version.minutes}</td>
                  <td className="px-ops-3 text-end tabular-nums text-ink-2">{r.version.subscriberCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {pageCount > 1 ? (
            <div className="flex items-center justify-end gap-2 border-t border-hairline px-ops-3 py-ops-2" data-packages-pagination="">
              <Button type="button" variant="ghost" size="sm" disabled={safePage <= 1} onClick={() => goPage(safePage - 1)}>Previous</Button>
              <span className="text-ops-label text-ink-2 tabular-nums">Page {safePage} of {pageCount}</span>
              <Button type="button" variant="ghost" size="sm" disabled={safePage >= pageCount} onClick={() => goPage(safePage + 1)}>Next</Button>
            </div>
          ) : null}
        </>
      )}
    </div>
  );

  const v = it?.version;
  const footer = it ? (
    <div className="flex w-full flex-col gap-ops-2">
      {v && v.subscriberCount > 0 ? (
        <p className="text-ops-label text-attention">{v.subscriberCount} businesses on this version.</p>
      ) : null}
      {canWrite ? (
        <div className="flex flex-wrap justify-end gap-2">
          {v?.status === "draft" ? (
            <Button type="button" variant="primary" size="sm" data-action="edit-draft" onClick={() => openEdit(it.pack, v)} disabled={pending}>
              Edit draft
            </Button>
          ) : v?.status === "published" ? (
            <>
              <Button type="button" variant="ghost" size="sm" data-action="archive-version" onClick={() => setArchiveOpen(true)}>
                Archive
              </Button>
              <Button type="button" variant="primary" size="sm" data-action="open-draft" pending={pending} onClick={() => void openOrCreateDraft(it.pack)}>
                Open draft
              </Button>
            </>
          ) : (
            <Button type="button" variant="primary" size="sm" data-action="open-draft" pending={pending} onClick={() => void openOrCreateDraft(it.pack)}>
              Open draft
            </Button>
          )}
        </div>
      ) : (
        <p className="text-right text-ops-label text-ink-2" data-blocked-why="">
          {unlocked && !editorOn ? (readOnlyHint || "Editor is off.") : "Unlock to edit."}
        </p>
      )}
    </div>
  ) : undefined;

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
            footer={footer}
          />
        }
      />

      <Drawer
        open={editOpen && !!form}
        onOpenChange={(next) => { if (!next && !pending) setEditOpen(false); }}
        title={form ? `Draft · ${form.name}` : "Draft"}
        dismissible={!pending}
        footer={
          <div className="flex w-full flex-wrap justify-end gap-2">
            <Button type="button" variant="ghost" size="md" disabled={pending} onClick={() => setEditOpen(false)}>Cancel</Button>
            <Button type="button" variant="ghost" size="md" pending={pending} onClick={() => void saveDraft()}>Save draft</Button>
            <Button type="button" variant="primary" size="md" pending={pending} onClick={() => void publishDraft()}>Publish</Button>
          </div>
        }
      >
        {form ? (
          <div className="flex flex-col gap-ops-3 text-ops-body text-ink" data-catalog-edit="">
            {error ? <p className="text-ops-label text-attention" role="alert">{error}</p> : null}
            {form && Number(form.minutes) >= 0 && it?.version.subscriberCount ? (
              <p className="text-ops-label text-ink-2">{it.version.subscriberCount} businesses on the live version.</p>
            ) : null}
            <label className="flex flex-col gap-1">
              <span className="text-ops-label font-semibold">Monthly (KSh)</span>
              <input className="ops-field" inputMode="numeric" value={form.monthly} onChange={(e) => setForm({ ...form, monthly: e.target.value })} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-ops-label font-semibold">Annual (KSh)</span>
              <input className="ops-field" inputMode="numeric" value={form.annual} onChange={(e) => setForm({ ...form, annual: e.target.value })} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-ops-label font-semibold">Minutes</span>
              <input className="ops-field" inputMode="numeric" value={form.minutes} onChange={(e) => setForm({ ...form, minutes: e.target.value })} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-ops-label font-semibold">Seats</span>
              <input className="ops-field" inputMode="numeric" value={form.seats} onChange={(e) => setForm({ ...form, seats: e.target.value })} />
            </label>
            {form.sku === "trial" ? (
              <label className="flex flex-col gap-1">
                <span className="text-ops-label font-semibold">Trial days</span>
                <input className="ops-field" inputMode="numeric" value={form.trialDays} onChange={(e) => setForm({ ...form, trialDays: e.target.value })} />
              </label>
            ) : null}
            <label className="flex flex-col gap-1">
              <span className="text-ops-label font-semibold">Reason</span>
              <textarea className="ops-field min-h-20" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why this change" />
            </label>
          </div>
        ) : null}
      </Drawer>

      <OpsConfirm
        open={archiveOpen}
        onClose={() => setArchiveOpen(false)}
        title="Archive this version?"
        strength="destructive"
        confirmLabel="Archive"
        pending={pending}
        requireReason
        onConfirm={(r) => void archiveVersion(r)}
      >
        {it ? (
          <p className="text-ops-body text-ink-2">
            {it.pack.name} v{it.version.version}. {it.version.subscriberCount} businesses on it.
          </p>
        ) : null}
      </OpsConfirm>
    </div>
  );
}
