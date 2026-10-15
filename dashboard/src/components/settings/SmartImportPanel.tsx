"use client";

/**
 * Import (DESK_SMART_IMPORT): paste, link or upload a photo, PDF or CSV. The preview groups
 * every item by the tab it lands on, marks New, Price change or Already saved, and flags
 * rows that need a look. Saving runs the same save paths a manual Settings save uses.
 */
import { withRoleGate } from "@/components/DeskRole";
import { useActionState, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { TenantRow } from "@/lib/supabase";
import { Sheet } from "@/components/ui/Sheet";
import { Button, pendingDotClass } from "@/components/ui/Button";
import { cx } from "@/lib/cx";
import {
  SettingsSegmented,
  settingsFieldClass,
  settingsPrimaryButtonClass,
} from "@/components/settingsUi";
import { smartImportExtractAction, type SmartImportState } from "@/app/(desk)/settings/smartImportActions";
import { saveAndCompileSettings } from "@/app/(desk)/settings/actions";
import { applyIngestAction } from "@/app/(desk)/settings/ingestActions";
import { applyCatalogImportAction } from "@/app/(desk)/settings/catalogActions";
import { diffCounts, groupByTarget, moveRow, type DiffDecision, type DiffRow } from "@/lib/smartImport/diffImport";
import { buildApplyPlan, type PlanStep } from "@/lib/smartImport/plan";
import { PROFILE_LABELS, SMART_TARGETS, TARGET_LABELS, type SmartTarget } from "@/lib/smartImport/schema";
import { classifyImportFile } from "@/lib/ingest/fileInput";

type Mode = "paste" | "url" | "file";
const MODES = [
  { id: "paste" as const, label: "Paste" },
  { id: "url" as const, label: "Website" },
  { id: "file" as const, label: "Photo or file" },
];

/** Photos are shrunk in the browser (long edge 1600 px, JPEG) so they stay well under 1 MB. */
async function shrinkImage(file: File): Promise<File> {
  if (!file.type.startsWith("image/")) return file;
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error("That photo couldn't be opened. Take a screenshot of it and upload that.");
  }
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const blob: Blob | null = await new Promise((res) => canvas.toBlob(res, "image/jpeg", 0.82));
  if (!blob) return file;
  return new File([blob], file.name.replace(/\.[a-z0-9]+$/i, "") + ".jpg", { type: "image/jpeg" });
}

function statusChip(row: DiffRow) {
  if (!row.applicable) return { label: "Add by hand", cls: "bg-surface-2 text-ink-2" };
  if (row.status === "new") return { label: "New", cls: "bg-accent-tonal text-accent" };
  if (row.status === "same") return { label: "Already saved", cls: "bg-surface-2 text-ink-2" };
  const catalog = row.target === "services" || row.target === "products";
  return { label: catalog ? "Price change" : "Update", cls: "bg-warn-soft text-warn" };
}

function rowTitle(row: DiffRow): string {
  const i = row.item;
  switch (row.target) {
    case "faqs":
      return i.question;
    case "coverage":
      return i.area;
    case "locations":
      return i.name || i.address;
    case "hours":
      return "Weekly hours";
    case "payments":
      return "How customers pay";
    case "policies":
      return i.policy_kind ? i.policy_kind.charAt(0).toUpperCase() + i.policy_kind.slice(1) : i.text;
    case "profile":
      return i.profile_field ? PROFILE_LABELS[i.profile_field] : i.text;
    default:
      return i.name || i.text || i.question || i.area;
  }
}

function rowDetail(row: DiffRow): string {
  const i = row.item;
  if (row.target === "faqs") return i.answer;
  if (row.target === "payments" || row.target === "policies") return i.text;
  if (row.target === "profile") return row.applicable ? row.change : `${row.change}. Change it on Business profile if it is right.`;
  if (row.target === "locations") return [i.address, i.landmark].filter(Boolean).join(", ");
  if (row.target === "hours")
    return Object.entries(i.days)
      .map(([d, v]) => `${d.charAt(0).toUpperCase()}${d.slice(1)} ${v}`)
      .join(", ");
  return row.change;
}

const runners = {
  settings: saveAndCompileSettings,
  ingest: applyIngestAction,
  catalogImport: applyCatalogImportAction,
} as const;

async function runStep(step: PlanStep): Promise<{ ok: boolean; error?: string }> {
  const fd = new FormData();
  for (const [k, v] of Object.entries(step.fields)) fd.set(k, v);
  const res = (await runners[step.action]({}, fd)) as { ok?: boolean; error?: string };
  return res?.error ? { ok: false, error: res.error } : { ok: true };
}

function SmartImportPanelInner({
  tenant,
  initialState,
  initialMode = "paste",
}: {
  tenant: TenantRow;
  /** Dev fixtures only (/dev/smart-import): open on a ready preview. */
  initialState?: SmartImportState;
  initialMode?: Mode;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>(initialMode);
  const [fileError, setFileError] = useState<string | null>(null);
  const [fileName, setFileName] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const preparedFile = useRef<File | null>(null);
  const [state, extract, extracting] = useActionState(
    async (prev: SmartImportState, fd: FormData) => {
      if (fd.get("source_mode") === "file") {
        if (!preparedFile.current) return { error: "Pick a photo, PDF or CSV first." };
        fd.set("file", preparedFile.current);
      }
      const next: SmartImportState = await smartImportExtractAction(prev, fd).catch(() => ({
        error: "We couldn't reach the server. Check your connection and try again.",
      }));
      if (next.rows) {
        setDecisions(Object.fromEntries(next.rows.map((r) => [r.key, r.decision])));
        setMoved({});
        setOpen(true);
      }
      return next;
    },
    initialState ?? ({} as SmartImportState)
  );
  const [decisions, setDecisions] = useState<Record<string, DiffDecision>>({});
  const [moved, setMoved] = useState<Record<string, DiffRow>>({});
  const [open, setOpen] = useState(Boolean(initialState?.rows));
  const [applying, setApplying] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  const rows = useMemo(
    () =>
      (state.rows || []).map((r) => {
        const base = moved[r.key] ?? r;
        return { ...base, decision: decisions[r.key] ?? base.decision };
      }),
    [state.rows, decisions, moved]
  );
  const counts = diffCounts(rows);
  const groups = groupByTarget(rows);

  async function onPickFile(file: File | null) {
    setFileError(null);
    preparedFile.current = null;
    setFileName("");
    if (!file) return;
    const check = classifyImportFile(file);
    if (!check.ok) {
      setFileError(check.error);
      return;
    }
    try {
      preparedFile.current = check.kind === "image" ? await shrinkImage(file) : file;
      setFileName(file.name);
    } catch (err) {
      setFileError(err instanceof Error ? err.message : "That file couldn't be opened.");
    }
  }

  async function apply() {
    if (!state.saved || !state.ctx) return;
    const steps = buildApplyPlan(rows, state.saved, state.ctx);
    if (!steps.length) return;
    setApplying(true);
    setResult(null);
    const done: string[] = [];
    for (const step of steps) {
      const res = await runStep(step).catch(() => ({ ok: false, error: "Connection lost." }));
      if (!res.ok) {
        setApplying(false);
        setResult({
          ok: false,
          text: `${done.length ? `Saved ${done.join(", ")}. ` : ""}Stopped at ${step.summary}: ${res.error}`,
        });
        router.refresh();
        return;
      }
      done.push(step.summary);
    }
    setApplying(false);
    setOpen(false);
    setResult({ ok: true, text: `Saved ${done.join(", ")}. Your assistant uses it on the next call.` });
    router.refresh();
  }

  function pickTarget(row: DiffRow, target: SmartTarget) {
    if (!state.saved) return;
    const next = moveRow(row, target, state.saved);
    setMoved((m) => ({ ...m, [row.key]: next }));
    setDecisions((d) => ({ ...d, [row.key]: "skip" }));
  }

  const toggle = (row: DiffRow) =>
    setDecisions((d) => ({
      ...d,
      [row.key]: (d[row.key] ?? row.decision) === "skip" ? (row.status === "new" ? "add" : "update") : "skip",
    }));

  return (
    <section className="space-y-4" data-smart-import="">
      <div className="space-y-1">
        <p className="text-body font-semibold text-ink">Import your business details</p>
        <p className="text-meta text-ink-2">
          Paste a menu or price list, add your website, or upload a photo, PDF or CSV. We sort it into Services,
          Products, FAQs, Locations, Hours, Payments and Policies. Nothing is saved until you check it.
        </p>
      </div>
      <SettingsSegmented label="Import from" value={mode} options={MODES} onChange={setMode} />
      <form action={extract} className="space-y-3">
        <input type="hidden" name="tenant_id" value={tenant.id} />
        <input type="hidden" name="source_mode" value={mode} />
        {mode === "paste" ? (
          <textarea
            name="paste"
            rows={8}
            aria-label="Paste your menu, price list or business details"
            placeholder={"Chapati 30\nChips mayai 250/=\nDelivery to Ruaka 200\nOpen Mon to Sat 8am to 8pm\nPay via M-Pesa till 123456"}
            className={cx(settingsFieldClass, "mt-0 leading-relaxed")}
          />
        ) : null}
        {mode === "url" ? (
          <input
            name="url"
            type="url"
            inputMode="url"
            aria-label="Website link"
            placeholder="https://yourbusiness.co.ke"
            className={cx(settingsFieldClass, "mt-0")}
          />
        ) : null}
        {mode === "file" ? (
          <div className="space-y-2">
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/heic,application/pdf,.csv,text/csv"
              className="sr-only"
              aria-label="Upload a photo, PDF or CSV"
              onChange={(e) => void onPickFile(e.target.files?.[0] ?? null)}
            />
            <Button type="button" variant="tonal" onClick={() => fileRef.current?.click()}>
              {fileName ? "Choose another file" : "Choose photo, PDF or CSV"}
            </Button>
            <p className="text-meta text-ink-2">
              {fileName ? fileName : "Up to 10 MB and 10 pages. Excel files: download as CSV first."}
            </p>
            {fileError ? <p className="text-meta text-attention">{fileError}</p> : null}
          </div>
        ) : null}
        <div className="flex items-center justify-end gap-3">
          {extracting ? <p className="text-meta text-ink-2">Reading. Photos and PDFs can take up to 30 seconds.</p> : null}
          <button type="submit" disabled={extracting} className={settingsPrimaryButtonClass}>
            {extracting ? <span className={pendingDotClass} aria-hidden /> : null}
            {extracting ? "Reading" : "Read it"}
          </button>
        </div>
        {state.error ? <p className="text-meta text-attention" role="alert">{state.error}</p> : null}
        {result ? (
          <p className={cx("text-meta", result.ok ? "text-ok" : "text-attention")} role="status">
            {result.text}
          </p>
        ) : null}
        {state.rows && !open ? (
          <Button type="button" variant="ghost" onClick={() => setOpen(true)}>
            Review {counts.total} found items
          </Button>
        ) : null}
      </form>

      <Sheet
        open={open}
        onOpenChange={setOpen}
        size="lg"
        title="Check what we found"
        description={`${counts.total} items: ${counts.new} new, ${counts.update} changed, ${counts.same} already saved${counts.review ? `, ${counts.review} need your review` : ""}.`}
        footer={
          <>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="button" variant="primary" disabled={applying || counts.selected === 0} onClick={() => void apply()}>
              {applying ? <span className={pendingDotClass} aria-hidden /> : null}
              {applying ? "Saving" : `Save ${counts.selected} selected`}
            </Button>
          </>
        }
      >
        <div className="space-y-5" data-smart-import-preview="">
          {state.message ? <p className="text-meta text-ink-2">{state.message}</p> : null}
          {groups.map((g) => (
            <div key={g.target} className="space-y-1.5">
              <p className="px-1 text-meta font-medium text-ink-2">
                {g.target === "unsure" ? "Not sure where this goes" : TARGET_LABELS[g.target]}{" "}
                <span className="tabular-nums">
                  ({g.rows.filter((r) => r.decision !== "skip").length} of {g.rows.length})
                </span>
              </p>
              <ul className="max-h-[min(24rem,55vh)] divide-y divide-hairline overflow-y-auto overscroll-contain rounded-2xl border border-hairline bg-surface">
                {g.rows.map((row) => {
                  const chip = statusChip(row);
                  const on = row.decision !== "skip";
                  return (
                    <li key={row.key}>
                      <label className={cx("flex min-h-11 items-start gap-3 px-4 py-2.5", row.applicable ? "cursor-pointer" : "opacity-60")}>
                        <input
                          type="checkbox"
                          className="mt-1 h-4 w-4 shrink-0 accent-accent"
                          checked={on && !row.unsure}
                          disabled={!row.applicable || row.unsure}
                          onChange={() => toggle(row)}
                          aria-label={`Include ${rowTitle(row)}`}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="flex flex-wrap items-center gap-1.5">
                            <span className="truncate text-body font-medium text-ink">{rowTitle(row)}</span>
                            <span className={cx("rounded-full px-2 py-0.5 text-meta font-medium", chip.cls)}>{chip.label}</span>
                            {row.needsReview && row.applicable ? (
                              <span className="rounded-full bg-attention-tonal px-2 py-0.5 text-meta font-medium text-attention">
                                Needs your review
                              </span>
                            ) : null}
                          </span>
                          <span className="mt-0.5 block text-meta text-ink-2">{rowDetail(row)}</span>
                          {row.item.evidence && row.needsReview ? (
                            <span className="mt-0.5 block truncate text-meta text-ink-3">From: &quot;{row.item.evidence}&quot;</span>
                          ) : null}
                        </span>
                      </label>
                          {row.unsure ? (
                            <select
                              aria-label={`Where should ${rowTitle(row)} go`}
                              className={cx(settingsFieldClass, "mt-0 mb-2.5 ml-11 h-11 max-w-[calc(100%-3.75rem)] sm:max-w-xs")}
                              value=""
                              onChange={(e) => e.target.value && pickTarget(row, e.target.value as SmartTarget)}
                            >
                              <option value="">Pick where this goes</option>
                              {SMART_TARGETS.map((t) => (
                                <option key={t} value={t}>
                                  {TARGET_LABELS[t]}
                                  {t === row.target ? " (best guess)" : t === row.item.alt_target ? " (also possible)" : ""}
                                </option>
                              ))}
                            </select>
                          ) : null}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
          {result && !result.ok ? <p className="text-meta text-attention" role="alert">{result.text}</p> : null}
        </div>
      </Sheet>
    </section>
  );
}

export const SmartImportPanel = withRoleGate("settings.edit", SmartImportPanelInner);
