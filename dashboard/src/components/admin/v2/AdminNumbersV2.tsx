"use client";

import { businessPaneHref } from "@/lib/ops/businessPane";
import { ARCHIVE_RESTORE_DAYS, releaseBlockReason } from "@/lib/adminBusinessModel";
import {
  archiveThenReleaseMaybeHold,
  releaseActions,
  releaseThenMaybeHold,
} from "@/lib/ops/archiveRelease";
import {
  clampHoldDays,
  feeLabel,
  numberHoldActions,
  reactivationFeeSurface,
  type HoldPolicy,
  type HoldReleaseMode,
} from "@/lib/ops/numberHold";
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
  type MoveTarget,
  type NumberRow,
  type NumberView,
  type WaitingBusiness,
} from "@/lib/ops/numbersView";
import { Button } from "@/components/ui/Button";
import { PageHeader, SplitLayout, SplitPane, StatusPill, EmptyState, OpsConfirm, UnlockCta } from "@/components/ops";
import { NumberControls } from "./NumberControls";
import "@/styles/ops.css";

const DATE = new Intl.DateTimeFormat("en-KE", { day: "numeric", month: "short", year: "numeric", timeZone: "Africa/Nairobi" });
const day = (iso: string | null) => (iso ? DATE.format(new Date(iso)) : "—");

type ConfirmKind = "assign" | "release" | "archive_release" | "hold" | "end_hold" | "restore" | null;

const DEFAULT_POLICY: HoldPolicy = { columnsPresent: false, enabled: false, defaultDays: 14, reactivationFeeKes: null };

/** Numbers as a table plus pane (ADMIN_V2). Assign/Release write through OpsConfirm; Hold/win-back uses #885 RPCs when present. */
export function AdminNumbersV2({
  rows: all,
  waiting,
  moveTargets = [],
  nowIso,
  holdPolicy = DEFAULT_POLICY,
}: {
  rows: NumberRow[];
  waiting: WaitingBusiness[];
  /** Businesses a live number can move to (number controls v1). */
  moveTargets?: MoveTarget[];
  nowIso: string;
  holdPolicy?: HoldPolicy;
}) {
  const router = useRouter();
  const now = useMemo(() => new Date(nowIso), [nowIso]);
  const [view, setView] = useState<NumberView>(() => defaultNumberView(all, waiting.length, now));
  const [query, setQuery] = useState("");
  const [sel, setSel] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<ConfirmKind>(null);
  const [assignTo, setAssignTo] = useState<string | null>(null);
  const [releaseMode, setReleaseMode] = useState<HoldReleaseMode>("hold");
  const [holdDays, setHoldDays] = useState(holdPolicy.defaultDays);
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

  useEffect(() => {
    setHoldDays(holdPolicy.defaultDays);
  }, [holdPolicy.defaultDays]);

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
  const holdActs = numberHoldActions({
    state,
    winbackHold: Boolean(it?.winbackHold),
    policy: holdPolicy,
    lastBusinessId: it?.lastBusinessId ?? null,
  });
  const fee = reactivationFeeSurface(holdPolicy.reactivationFeeKes);

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
    if (confirm === "release" || confirm === "archive_release" || confirm === "hold") {
      setReleaseMode(holdActs.chooseOnRelease || holdActs.startHold ? "hold" : "free");
      setHoldDays(holdPolicy.defaultDays);
    }
  }, [confirm, waiting, holdActs.chooseOnRelease, holdActs.startHold, holdPolicy.defaultDays]);

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

  async function postHold(body: Record<string, unknown>, okStatus: string) {
    setPending(true);
    setError("");
    setStatus("");
    try {
      const res = await fetch("/api/admin/number-hold", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(json.error || "Could not update hold.");
        return false;
      }
      setConfirm(null);
      setStatus(okStatus);
      startTransition(() => router.refresh());
      return true;
    } catch {
      setError("Could not update hold.");
      return false;
    } finally {
      setPending(false);
    }
  }

  async function runArchiveRelease(reason: string) {
    if (!it?.businessId) return;
    setPending(true);
    setError("");
    setStatus("");
    const mode: HoldReleaseMode = holdActs.chooseOnRelease ? releaseMode : "free";
    const days = mode === "hold" ? clampHoldDays(holdDays, holdPolicy.defaultDays) : null;
    const r = await archiveThenReleaseMaybeHold(it.businessId, it.e164, reason, mode, days);
    setPending(false);
    if (!r.ok) {
      setError(r.error);
      if (r.step !== "archive") startTransition(() => router.refresh());
      return;
    }
    setConfirm(null);
    setStatus(
      mode === "hold"
        ? `${it.businessName ?? "Business"} archived. ${formatE164(it.e164)} is on win-back hold for ${days} days.`
        : `${it.businessName ?? "Business"} archived. ${formatE164(it.e164)} is Available.`,
    );
    startTransition(() => router.refresh());
  }

  async function runJustRelease(reason: string) {
    if (!it) return;
    setPending(true);
    setError("");
    setStatus("");
    const mode: HoldReleaseMode = holdActs.chooseOnRelease ? releaseMode : "free";
    const days = mode === "hold" ? clampHoldDays(holdDays, holdPolicy.defaultDays) : null;
    const r = await releaseThenMaybeHold(it.e164, reason || "Just release", mode, days);
    setPending(false);
    if (!r.ok) {
      setError(r.error);
      if (r.step === "hold") startTransition(() => router.refresh());
      return;
    }
    setConfirm(null);
    setStatus(
      mode === "hold"
        ? `${formatE164(it.e164)} is on win-back hold for ${days} days.`
        : `${formatE164(it.e164)} is Available.`,
    );
    startTransition(() => router.refresh());
  }

  function openAssign() {
    setError("");
    setConfirm("assign");
  }

  function openRelease() {
    setError("");
    setConfirm("release");
  }

  const assignBusiness = waiting.find((w) => w.id === assignTo) ?? null;

  const holdChoice = (show: boolean) =>
    show ? (
      <fieldset className="flex flex-col gap-2 border-t border-hairline pt-ops-3" data-hold-choice="">
        <legend className="text-ops-label font-semibold text-ink">After release</legend>
        <label className="flex min-h-ops-touch items-start gap-2 text-ink">
          <input
            type="radio"
            name="release-mode"
            value="hold"
            checked={releaseMode === "hold"}
            onChange={() => setReleaseMode("hold")}
            disabled={pending}
            className="mt-1"
          />
          <span>
            <span className="font-semibold">Hold for win-back</span>
            <span className="mt-0.5 block text-ops-label text-ink-2">
              Keep the number for the previous business. Callers hear that the line is unavailable. Default {holdPolicy.defaultDays} days.
            </span>
          </span>
        </label>
        {releaseMode === "hold" ? (
          <label className="ms-6 flex max-w-[12rem] flex-col gap-1">
            <span className="text-ops-label text-ink">Hold length (days)</span>
            <input
              type="number"
              min={1}
              max={90}
              value={holdDays}
              onChange={(e) => setHoldDays(clampHoldDays(Number(e.target.value), holdPolicy.defaultDays))}
              disabled={pending}
              data-field="hold-days"
              className="ops-field tabular-nums text-ink"
            />
          </label>
        ) : null}
        <label className="flex min-h-ops-touch items-start gap-2 text-ink">
          <input
            type="radio"
            name="release-mode"
            value="free"
            checked={releaseMode === "free"}
            onChange={() => setReleaseMode("free")}
            disabled={pending}
            className="mt-1"
          />
          <span>
            <span className="font-semibold">Free to pool</span>
            <span className="mt-0.5 block text-ops-label text-ink-2">No win-back. Number becomes Available after the normal wait.</span>
          </span>
        </label>
        {releaseMode === "hold" && fee.kes != null ? (
          <p className="text-ops-label text-ink-2" data-reactivation-fee="">
            Reactivation fee if they come back: {fee.label}. {fee.note}
          </p>
        ) : null}
      </fieldset>
    ) : null;

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
      {!holdPolicy.columnsPresent ? (
        <p className="pb-ops-2 text-ops-label text-ink-2" role="status" data-hold-sql-missing="">
          Win-back hold controls need the hold SQL on this database (#885). Release still works.
        </p>
      ) : !holdPolicy.enabled ? (
        <p className="pb-ops-2 text-ops-label text-ink-2" role="status" data-hold-off="">
          Hold and win-back is Off in Settings. New holds are not offered; running holds can still end or restore.
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
          <Button type="button" variant="primary" size="sm" data-action="archive-release" onClick={() => { setError(""); setConfirm("archive_release"); }}>
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
        {holdActs.startHold ? (
          <Button type="button" variant="primary" size="sm" data-action="start-hold" onClick={() => { setError(""); setConfirm("hold"); }}>
            Hold for win-back
          </Button>
        ) : null}
        {holdActs.endHold ? (
          <Button type="button" variant="ghost" size="sm" data-action="end-hold" onClick={() => { setError(""); setConfirm("end_hold"); }}>
            End hold early
          </Button>
        ) : null}
        {holdActs.restore ? (
          <Button type="button" variant="primary" size="sm" data-action="restore-hold" onClick={() => { setError(""); setConfirm("restore"); }}>
            Restore to {it.lastBusinessName ?? "previous business"}
          </Button>
        ) : null}
        <span data-honest="unlock">
          <UnlockCta
            site="numbers"
            action="numbers:write"
            target={it?.e164 ?? null}
            what="assign, release, hold, move or restore this number"
            label="Unlock"
            variant="ghost"
          />
        </span>
      </div>
      <NumberControls
        key={it.id}
        row={it}
        moveTargets={moveTargets}
        hideRestore={holdActs.restore}
        hideLift={holdActs.endHold}
        onChanged={(message) => {
          setStatus(message);
          startTransition(() => router.refresh());
        }}
      />
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
              ...(it.winbackHold ? [{ label: "Win-back", value: "Yes — previous business only" }] : []),
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
        onConfirm={(reason) => { void runJustRelease(reason || "Just release"); }}
        title="Release this number?"
        strength="destructive"
        requireReason={holdActs.chooseOnRelease && releaseMode === "hold"}
        confirmLabel={holdActs.chooseOnRelease && releaseMode === "hold" ? "Release and hold" : "Release number"}
        pending={pending}
      >
        {error ? <p className="pb-2 text-attention" role="alert">{error}</p> : null}
        <p>
          {it
            ? it.businessName
              ? `${formatE164(it.e164)} leaves ${it.businessName}.`
              : `${formatE164(it.e164)} returns to the pool.`
            : ""}
        </p>
        {holdChoice(holdActs.chooseOnRelease)}
      </OpsConfirm>
      <OpsConfirm
        open={confirm === "archive_release" && !!it}
        onClose={() => { if (!pending) setConfirm(null); }}
        onConfirm={(reason) => { void runArchiveRelease(reason); }}
        title="Archive the business and release this number?"
        strength="destructive"
        requireReason
        confirmLabel={holdActs.chooseOnRelease && releaseMode === "hold" ? "Archive, release and hold" : "Archive & release"}
        pending={pending}
      >
        {error ? <p className="pb-2 text-attention" role="alert">{error}</p> : null}
        <p>
          {it
            ? `${it.businessName ?? "This business"} is archived: its line closes, charging stops and the owner can't sign in. You can restore it within ${ARCHIVE_RESTORE_DAYS} days.`
            : ""}
        </p>
        {holdChoice(holdActs.chooseOnRelease)}
      </OpsConfirm>

      <OpsConfirm
        open={confirm === "hold" && !!it}
        onClose={() => { if (!pending) setConfirm(null); }}
        onConfirm={(reason) => {
          if (!it) return;
          void postHold(
            { action: "hold", e164: it.e164, days: clampHoldDays(holdDays, holdPolicy.defaultDays), reason },
            `${formatE164(it.e164)} is on win-back hold for ${clampHoldDays(holdDays, holdPolicy.defaultDays)} days.`,
          );
        }}
        title="Hold this number for win-back?"
        strength="money"
        requireReason
        confirmLabel="Hold for win-back"
        pending={pending}
        amount={fee.kes ?? undefined}
      >
        {error ? <p className="pb-2 text-attention" role="alert">{error}</p> : null}
        <p>
          {it
            ? `${formatE164(it.e164)} stays for ${it.lastBusinessName ?? "the previous business"}. Callers hear that the line is unavailable until the hold ends.`
            : ""}
        </p>
        <label className="flex max-w-[12rem] flex-col gap-1">
          <span className="text-ops-label text-ink">Hold length (days)</span>
          <input
            type="number"
            min={1}
            max={90}
            value={holdDays}
            onChange={(e) => setHoldDays(clampHoldDays(Number(e.target.value), holdPolicy.defaultDays))}
            disabled={pending}
            data-field="hold-days"
            className="ops-field tabular-nums text-ink"
          />
        </label>
        <p className="text-ops-label text-ink-2" data-reactivation-fee="">
          {fee.label}. {fee.note}
        </p>
      </OpsConfirm>

      <OpsConfirm
        open={confirm === "end_hold" && !!it}
        onClose={() => { if (!pending) setConfirm(null); }}
        onConfirm={(reason) => {
          if (!it) return;
          void postHold({ action: "end_hold", e164: it.e164, reason }, `${formatE164(it.e164)} is Available.`);
        }}
        title="End this hold early?"
        strength="destructive"
        requireReason
        confirmLabel="End hold"
        pending={pending}
      >
        {error ? <p className="pb-2 text-attention" role="alert">{error}</p> : null}
        <p>
          {it
            ? `${formatE164(it.e164)} becomes Available now. ${it.lastBusinessName ?? "The previous business"} can no longer reclaim it on this hold.`
            : ""}
        </p>
      </OpsConfirm>

      <OpsConfirm
        open={confirm === "restore" && !!it}
        onClose={() => { if (!pending) setConfirm(null); }}
        onConfirm={(reason) => {
          if (!it?.lastBusinessId) return;
          void postHold(
            { action: "restore", e164: it.e164, tenant_id: it.lastBusinessId, reason },
            `${formatE164(it.e164)} restored to ${it.lastBusinessName ?? "the previous business"}.`,
          );
        }}
        title="Restore this number to the previous business?"
        strength={fee.kes != null ? "money" : "light"}
        requireReason
        confirmLabel="Restore number"
        pending={pending}
        amount={fee.kes ?? undefined}
      >
        {error ? <p className="pb-2 text-attention" role="alert">{error}</p> : null}
        <p>
          {it
            ? `${formatE164(it.e164)} goes back to ${it.lastBusinessName ?? "the previous business"}. That business must already be active on a package.`
            : ""}
        </p>
        <p className="text-ops-label text-ink-2" data-reactivation-fee="">
          {fee.kes != null ? `Reactivation fee on the package invoice: ${feeLabel(fee.kes)}. ` : ""}
          {fee.note}
        </p>
      </OpsConfirm>
    </div>
  );
}
