"use client";

import { businessPaneHref } from "@/lib/ops/businessPane";
import { ARCHIVE_RESTORE_DAYS, releaseBlockReason } from "@/lib/adminBusinessModel";
import { archiveThenRelease, releaseActions } from "@/lib/ops/archiveRelease";
import { useRouter } from "next/navigation";
import { startTransition, useEffect, useMemo, useState } from "react";
import {
  NUMBER_VIEWS,
  defaultNumberView,
  formatE164,
  inNumberView,
  isHeld,
  matchesNumber,
  numberCounts,
  numberState,
  numberTone,
  statusLabel,
  type NumberRow,
  type NumberView,
  type WaitingBusiness,
} from "@/lib/ops/numbersView";
import { Button } from "@/components/ui/Button";
import { PageHeader, SplitLayout, SplitPane, StatusPill, EmptyState, OpsConfirm } from "@/components/ops";
import "@/styles/ops.css";

const DATE = new Intl.DateTimeFormat("en-KE", { day: "numeric", month: "short", year: "numeric", timeZone: "Africa/Nairobi" });
const day = (iso: string | null) => (iso ? DATE.format(new Date(iso)) : "—");

type ConfirmKind = "assign" | "release" | "archive_release" | null;
type HonestNote = "unlock" | "hold" | null;

/** Numbers as a table plus pane (ADMIN_V2). Assign/Release write through OpsConfirm; Unlock/Hold stay honest until step-up enrolment. */
export function AdminNumbersV2({ rows: all, waiting, nowIso }: { rows: NumberRow[]; waiting: WaitingBusiness[]; nowIso: string }) {
  const router = useRouter();
  const now = useMemo(() => new Date(nowIso), [nowIso]);
  const [view, setView] = useState<NumberView>(() => defaultNumberView(all, waiting.length, now));
  const [query, setQuery] = useState("");
  const [sel, setSel] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<ConfirmKind>(null);
  const [assignTo, setAssignTo] = useState<string | null>(null);
  const [note, setNote] = useState<HonestNote>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");

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
  const state = it ? numberState(it, now) : null;
  const blockRelease = it
    ? releaseBlockReason({
        linked: Boolean(it.businessId),
        businessName: it.businessName,
        isActive: it.businessActive,
      })
    : null;
  const acts = releaseActions(state, blockRelease, it?.businessId ?? null);

  async function runArchiveRelease() {
    if (!it?.businessId) return;
    setPending(true);
    setError("");
    setStatus("");
    const r = await archiveThenRelease(it.businessId, it.e164);
    setPending(false);
    if (!r.ok) {
      setError(r.error);
      if (r.step === "release") startTransition(() => router.refresh());
      return;
    }
    setConfirm(null);
    setStatus(`${it.businessName ?? "Business"} archived. ${formatE164(it.e164)} is Available.`);
    startTransition(() => router.refresh());
  }

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

  useEffect(() => {
    if (confirm === "assign") setAssignTo(waiting[0]?.id ?? null);
  }, [confirm, waiting]);

  const freeingNext = useMemo(
    () => all.filter((r) => isHeld(r, now) && r.holdUntil).sort((a, b) => a.holdUntil!.localeCompare(b.holdUntil!)),
    [all, now],
  );
  const who = (r: NumberRow) =>
    r.businessName ?? (isHeld(r, now) && r.lastBusinessName ? `Was ${r.lastBusinessName}` : "—");

  async function postPool(body: Record<string, string>) {
    setPending(true);
    setError("");
    setStatus("");
    try {
      const res = await fetch("/api/did-pool", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string; e164?: string };
      if (!res.ok) {
        setError(json.error || "Could not save.");
        return false;
      }
      setConfirm(null);
      setStatus(
        body.action === "release"
          ? `${formatE164(body.e164 || "")} is Available.`
          : `Assigned ${formatE164(json.e164 || body.e164 || "")}.`,
      );
      startTransition(() => router.refresh());
      return true;
    } catch {
      setError("Could not save.");
      return false;
    } finally {
      setPending(false);
    }
  }

  function openAssign() {
    setError("");
    setNote(null);
    setConfirm("assign");
  }

  function openRelease() {
    setError("");
    setNote(null);
    setConfirm("release");
  }

  function showHonest(kind: HonestNote) {
    setConfirm(null);
    setError("");
    setNote(kind);
  }

  const assignBusiness = waiting.find((w) => w.id === assignTo) ?? null;

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
      {status ? (
        <p className="pb-ops-2 text-ops-body text-ok" role="status" data-numbers-status="">
          {status}
        </p>
      ) : null}
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

  const footer = it ? (
    <div className="flex w-full flex-col gap-ops-2" data-numbers-actions="">
      {note ? (
        <p className="rounded-sm border border-hairline bg-canvas px-ops-3 py-ops-2 text-ops-label text-ink-2" role="status" data-honest-note="">
          Secure sign-in is next. {note === "hold" ? "Hold" : "Unlock"} waits for step-up — this button does not change the number yet.{" "}
          <button type="button" className="font-semibold text-ink underline-offset-2 hover:underline" onClick={() => setNote(null)}>
            Dismiss
          </button>
        </p>
      ) : null}
      {error && !confirm ? (
        <p className="text-ops-body text-attention" role="alert">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        {state === "available" ? (
          <Button type="button" variant="primary" size="sm" onClick={openAssign} disabled={waiting.length === 0} title={waiting.length === 0 ? "No business is waiting for a number" : undefined}>
            Assign
          </Button>
        ) : null}
        {acts.archiveRelease ? (
          <Button type="button" variant="primary" size="sm" data-action="archive-release" onClick={() => { setError(""); setNote(null); setConfirm("archive_release"); }}>
            Archive &amp; release
          </Button>
        ) : null}
        {state === "assigned" ? (
          <>
            {acts.justReleaseWhy ? (
              <span id={`release-why-${it.id}`} className="sr-only">
                {acts.justReleaseWhy}
              </span>
            ) : null}
            <Button type="button" variant="ghost" size="sm" data-action="just-release" onClick={openRelease} disabled={!acts.justRelease} title={acts.justReleaseWhy ?? undefined} aria-describedby={acts.justReleaseWhy ? `release-why-${it.id}` : undefined}>
              Just release
            </Button>
          </>
        ) : null}
        <Button type="button" variant="ghost" size="sm" data-honest="hold" onClick={() => showHonest("hold")}>
          Hold
        </Button>
        <Button type="button" variant="ghost" size="sm" data-honest="unlock" onClick={() => showHonest("unlock")}>
          Unlock
        </Button>
      </div>
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
            footer={footer}
          />
        }
      />

      <OpsConfirm
        open={confirm === "assign" && !!it}
        onClose={() => { if (!pending) setConfirm(null); }}
        onConfirm={() => {
          if (!it || !assignTo) return;
          void postPool({ action: "assign_specific", tenant_id: assignTo, e164: it.e164 });
        }}
        title="Assign this number?"
        strength="light"
        confirmLabel="Assign number"
        pending={pending}
      >
        {error ? <p className="pb-2 text-attention" role="alert">{error}</p> : null}
        <p>
          {it ? `${formatE164(it.e164)} goes to ${assignBusiness?.name ?? "the business you pick"}. They can take calls on it once it is live.` : ""}
        </p>
        {waiting.length === 0 ? (
          <p className="text-ink-2">No business is waiting for a number.</p>
        ) : (
          <fieldset className="flex flex-col gap-1">
            <legend className="text-ops-label text-ink">Business</legend>
            {waiting.map((w) => (
              <label key={w.id} className="flex min-h-ops-touch items-center gap-2 text-ink">
                <input
                  type="radio"
                  name="assign-business"
                  value={w.id}
                  checked={assignTo === w.id}
                  onChange={() => setAssignTo(w.id)}
                  disabled={pending}
                />
                <span>{w.name}<span className="text-ink-2"> · since {day(w.since)}</span></span>
              </label>
            ))}
          </fieldset>
        )}
      </OpsConfirm>

      <OpsConfirm
        open={confirm === "release" && !!it}
        onClose={() => { if (!pending) setConfirm(null); }}
        onConfirm={() => {
          if (!it) return;
          void postPool({ action: "release", e164: it.e164 });
        }}
        title="Release this number?"
        strength="destructive"
        confirmLabel="Release number"
        pending={pending}
      >
        {error ? <p className="pb-2 text-attention" role="alert">{error}</p> : null}
        <p>
          {it
            ? it.businessName
              ? `${formatE164(it.e164)} returns to Available. ${it.businessName} waits for a new number.`
              : `${formatE164(it.e164)} returns to Available.`
            : ""}
        </p>
      </OpsConfirm>
      <OpsConfirm
        open={confirm === "archive_release" && !!it}
        onClose={() => { if (!pending) setConfirm(null); }}
        onConfirm={() => { void runArchiveRelease(); }}
        title="Archive the business and release this number?"
        strength="destructive"
        confirmLabel="Archive & release"
        pending={pending}
      >
        {error ? <p className="pb-2 text-attention" role="alert">{error}</p> : null}
        <p>
          {it
            ? `${it.businessName ?? "This business"} is archived: its line closes, charging stops and the owner can't sign in. You can restore it within ${ARCHIVE_RESTORE_DAYS} days. Then ${formatE164(it.e164)} returns to Available.`
            : ""}
        </p>
      </OpsConfirm>
    </div>
  );
}
