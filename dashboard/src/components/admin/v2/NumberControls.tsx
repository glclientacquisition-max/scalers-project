"use client";

import { useMemo, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { Drawer, StatusPill } from "@/components/ops";
import {
  PROTECTED_COPY,
  numberOpsFor,
  type NumberOp,
  type NumberOpResult,
} from "@/lib/ops/numberOps";
import { formatE164, type MoveTarget, type NumberRow } from "@/lib/ops/numbersView";

const DATE = new Intl.DateTimeFormat("en-KE", { day: "numeric", month: "short", year: "numeric", timeZone: "Africa/Nairobi" });
const day = (iso: string | null) => (iso ? DATE.format(new Date(iso)) : "Not set");

type Failure = { error: string; code?: string; suggestRestore?: boolean; needsConfirm?: boolean };

const TITLE: Record<NumberOp, string> = {
  lift_quarantine: "Make this number available now?",
  restore: "Bring this number back?",
  move: "Move this number?",
};
const CONFIRM: Record<NumberOp, string> = {
  lift_quarantine: "Make available",
  restore: "Bring it back",
  move: "Move number",
};
const MOVE_WORD = "MOVE";

/** Inset grouped list (iOS Settings style) in Ops tokens. */
function Group({ label, children }: { label?: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-1">
      {label ? <h3 className="px-ops-3 text-ops-label font-semibold uppercase tracking-wide text-ink-2">{label}</h3> : null}
      <div className="divide-y divide-hairline overflow-hidden rounded-lg bg-surface-2">{children}</div>
    </section>
  );
}
function Fact({ k, children }: { k: string; children: ReactNode }) {
  return (
    <div className="flex min-h-ops-row items-center justify-between gap-ops-3 px-ops-3 py-ops-2 text-ops-body">
      <span className="text-ink-2">{k}</span>
      <span className="min-w-0 truncate text-end text-ink">{children}</span>
    </div>
  );
}

/**
 * Number controls v1 for the Numbers pane: Make available now (lift quarantine),
 * Bring back (restore to its last business) and Move to another business.
 * Every write: typed reason, Unlock (server gate; StepUpHost opens the sheet on 403),
 * protected line refused here and on the server. Result shows as a summary, never a toast.
 */
export function NumberControls({
  row,
  moveTargets,
  onChanged,
  hideRestore = false,
  hideLift = false,
}: {
  row: NumberRow;
  moveTargets: MoveTarget[];
  onChanged: (message: string) => void;
  /** A win-back hold keeps its own Restore / End hold (number-hold route); don't show two. */
  hideRestore?: boolean;
  hideLift?: boolean;
}) {
  const ops = numberOpsFor(row);
  const [op, setOp] = useState<NumberOp | null>(null);
  const [reason, setReason] = useState("");
  const [touched, setTouched] = useState(false);
  const [typed, setTyped] = useState("");
  const [target, setTarget] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [needsUnlock, setNeedsUnlock] = useState(false);
  const [result, setResult] = useState<NumberOpResult | null>(null);

  const targets = useMemo(
    () => moveTargets.filter((t) => t.id !== row.businessId && (!query.trim() || t.name.toLowerCase().includes(query.trim().toLowerCase()))),
    [moveTargets, row.businessId, query],
  );
  const targetName = moveTargets.find((t) => t.id === target)?.name ?? null;
  const lastName = row.lastBusinessName ?? "its last business";

  function open(next: NumberOp) {
    setOp(next);
    setReason("");
    setTouched(false);
    setTyped("");
    setTarget(null);
    setQuery("");
    setFailure(null);
    setNeedsUnlock(false);
    setResult(null);
  }
  function close() {
    if (pending) return;
    if (result) onChanged(result.noop ? `${formatE164(result.e164)}: already done.` : `${result.headline}.`);
    setOp(null);
  }

  const reasonShort = reason.trim().length < 3;
  const blockedWhy = !op || result
    ? null
    : ops.protectedLine
      ? PROTECTED_COPY
      : op === "move" && !target
        ? "Pick a business to move it to."
        : reasonShort
          ? "Add a reason to continue."
          : op === "move" && typed.trim().toUpperCase() !== MOVE_WORD
            ? `Type ${MOVE_WORD} to continue.`
            : null;

  async function submit(which: NumberOp, opts: { confirm?: boolean } = {}) {
    if (ops.protectedLine) return;
    setPending(true);
    setFailure(null);
    setNeedsUnlock(false);
    const body: Record<string, unknown> =
      which === "restore"
        ? { action: "restore", business_id: row.lastBusinessId, e164: row.e164, reason: reason.trim() }
        : which === "lift_quarantine"
          ? { action: "lift_quarantine", e164: row.e164, reason: reason.trim(), confirm: opts.confirm === true }
          : { action: "move", e164: row.e164, from_business_id: row.businessId, to_business_id: target, reason: reason.trim(), confirm: true };
    try {
      const res = await fetch("/api/admin/number-ops", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await res.json().catch(() => ({}))) as Partial<NumberOpResult> & Failure & { message?: string };
      if (res.status === 403 && json.error === "step_up_required") {
        setNeedsUnlock(true);
        return;
      }
      if (!res.ok) {
        setFailure({ error: json.error || "Couldn't make the change. Nothing was changed.", code: json.code, suggestRestore: json.suggestRestore, needsConfirm: json.needsConfirm });
        return;
      }
      setOp(which);
      setResult(json as NumberOpResult);
    } catch {
      setFailure({ error: "Couldn't reach Admin. Nothing was changed." });
    } finally {
      setPending(false);
    }
  }

  const btn = (which: NumberOp, label: string, variant: "primary" | "ghost" | "danger", show: boolean) =>
    show ? (
      <Button
        type="button"
        variant={variant}
        size="sm"
        data-action={`number-ops-${which}`}
        disabled={ops.protectedLine}
        aria-describedby={ops.protectedLine ? `numops-protected-${row.id}` : undefined}
        title={ops.protectedLine ? PROTECTED_COPY : undefined}
        onClick={() => open(which)}
      >
        {label}
      </Button>
    ) : null;

  const anyControl = (ops.lift && !hideLift) || (ops.restore && !hideRestore) || ops.move;
  if (!anyControl && !ops.protectedLine) return null;

  return (
    <div className="flex w-full flex-col gap-ops-2" data-number-controls="">
      <div className="flex flex-wrap items-center gap-2">
        {btn("restore", `Bring back to ${lastName}`, "primary", ops.restore && !hideRestore)}
        {btn("lift_quarantine", "Make available now", "ghost", ops.lift && !hideLift)}
        {btn("move", "Move to another business", "danger", ops.move)}
      </div>
      {ops.protectedLine ? (
        <p id={`numops-protected-${row.id}`} className="text-ops-label text-ink-2" data-protected-line="">
          {PROTECTED_COPY}
        </p>
      ) : null}

      <Drawer
        open={op != null}
        title={result ? (result.noop ? "Already done" : "Done") : op ? TITLE[op] : ""}
        dismissible={!pending}
        onOpenChange={(next) => { if (!next) close(); }}
        footer={
          result ? (
            <Button variant="primary" size="md" onClick={close} data-action="number-ops-done">Done</Button>
          ) : (
            <div className="flex w-full flex-col gap-ops-2" data-confirm-footer="">
              {blockedWhy && !pending ? (
                <p id="numops-blocked-why" className="text-end text-ops-label text-ink-2" data-blocked-why="">{blockedWhy}</p>
              ) : null}
              <div className="flex items-center justify-end gap-2">
                <Button variant="ghost" size="md" onClick={close} disabled={pending}>Cancel</Button>
                <Button
                  variant={op === "restore" ? "primary" : "dangerSolid"}
                  size="md"
                  pending={pending}
                  disabled={Boolean(blockedWhy)}
                  aria-describedby={blockedWhy ? "numops-blocked-why" : undefined}
                  data-action="number-ops-confirm"
                  onClick={() => { if (op) void submit(op); }}
                >
                  {op ? CONFIRM[op] : ""}
                </Button>
              </div>
            </div>
          )
        }
      >
        <div className="ops-theme flex flex-col gap-ops-4 text-ops-body text-ink" data-number-ops-sheet={op ?? ""}>
          {result ? (
            <>
              <div className="flex items-center gap-2" role="status" data-number-ops-result={result.noop ? "noop" : "done"}>
                <StatusPill tone={result.noop ? "neutral" : "ok"}>{result.noop ? "Already done" : "Done"}</StatusPill>
                <span className="text-ops-heading">{result.headline}</span>
              </div>
              {result.noop ? <p className="text-ink-2">Nothing changed. It was already like this.</p> : null}
              <Group label="Summary">
                <Fact k="Number"><span className="tabular-nums">{formatE164(result.e164 || row.e164)}</span></Fact>
                {result.poolStatus ? <Fact k="Status now">{result.poolStatus}</Fact> : null}
                {result.action === "move" ? (
                  <>
                    <Fact k="From">{result.fromName ?? row.businessName ?? "Previous business"}</Fact>
                    <Fact k="To">{result.toName ?? targetName ?? "New business"}</Fact>
                  </>
                ) : null}
                {result.action === "restore" ? <Fact k="Business">{result.businessName ?? lastName}</Fact> : null}
                <Fact k="Reason">{reason.trim()}</Fact>
              </Group>
              {result.note ? (
                <p className="rounded-lg bg-accent/10 px-ops-3 py-ops-2 text-ink" data-move-cache-note="">{result.note}</p>
              ) : null}
              <p className="text-ops-label text-ink-2">Saved to the audit log.</p>
            </>
          ) : op ? (
            <>
              <p className={op === "restore" ? "text-ink" : "border-l-2 border-attention ps-ops-3 text-ink"} data-consequence="">
                {op === "lift_quarantine"
                  ? `${formatE164(row.e164)} leaves its hold and becomes Available for any business. ${lastName} can't reclaim it after this.`
                  : op === "restore"
                    ? `${formatE164(row.e164)} goes back to ${lastName} now. Calls to it reach that business again.`
                    : `${formatE164(row.e164)} leaves ${row.businessName ?? "this business"}, which is left with no line. Calls go to the business you pick.`}
              </p>

              <Group label="Number">
                <Fact k="Number"><span className="tabular-nums">{formatE164(row.e164)}</span></Fact>
                {op === "move" ? (
                  <Fact k="Business now">{row.businessName ?? "None"}</Fact>
                ) : (
                  <>
                    <Fact k="Last business">{row.lastBusinessName ?? "None"}</Fact>
                    <Fact k="On hold until">{day(row.holdUntil)}</Fact>
                  </>
                )}
              </Group>

              {op === "move" ? (
                <section className="flex flex-col gap-1" data-move-targets="">
                  <h3 className="px-ops-3 text-ops-label font-semibold uppercase tracking-wide text-ink-2">Move to</h3>
                  {moveTargets.length > 6 ? (
                    <input
                      type="search"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder="Search businesses"
                      aria-label="Search businesses"
                      className="ops-field text-ink"
                      disabled={pending}
                    />
                  ) : null}
                  {targets.length === 0 ? (
                    <p className="rounded-lg bg-surface-2 px-ops-3 py-ops-2 text-ink-2">
                      No business can take it. A business needs to be active and have no line of its own.
                    </p>
                  ) : (
                    <div role="radiogroup" aria-label="Move to" className="max-h-64 divide-y divide-hairline overflow-y-auto rounded-lg bg-surface-2">
                      {targets.map((t) => (
                        <label key={t.id} className="flex min-h-ops-touch cursor-pointer items-center gap-ops-3 px-ops-3 text-ink">
                          <input
                            type="radio"
                            name={`move-to-${row.id}`}
                            value={t.id}
                            checked={target === t.id}
                            onChange={() => setTarget(t.id)}
                            disabled={pending}
                          />
                          <span className="min-w-0 flex-1 truncate">{t.name}</span>
                        </label>
                      ))}
                    </div>
                  )}
                  <p className="px-ops-3 text-ops-label text-ink-2">
                    Only active businesses with no line are listed. No swaps.
                  </p>
                </section>
              ) : null}

              <label className="flex flex-col gap-1">
                <span className="text-ops-label font-semibold text-ink">Reason</span>
                <textarea
                  value={reason}
                  rows={2}
                  onChange={(e) => setReason(e.target.value)}
                  onBlur={() => setTouched(true)}
                  aria-invalid={touched && reasonShort}
                  aria-describedby={`numops-reason-hint-${row.id}`}
                  data-field="reason"
                  disabled={pending}
                  placeholder={op === "move" ? "e.g. Owner sold the business to the new owner" : "e.g. Released by mistake"}
                  className="ops-field text-ink"
                />
                <span id={`numops-reason-hint-${row.id}`} className={touched && reasonShort ? "text-ops-label text-attention" : "text-ops-label text-ink-2"}>
                  {touched && reasonShort ? "Add a reason (3 characters or more)." : "3 characters or more. Saved to the audit log."}
                </span>
              </label>

              {op === "move" ? (
                <label className="flex flex-col gap-1">
                  <span className="text-ops-label text-ink">Type {MOVE_WORD} to confirm</span>
                  <input value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" className="ops-field text-ink" data-field="type-to-confirm" disabled={pending} />
                </label>
              ) : null}

              <p className="text-ops-label text-ink-2">Needs Unlock with your authenticator.</p>

              {needsUnlock ? (
                <p className="rounded-lg bg-surface-2 px-ops-3 py-ops-2 text-ink" role="status" data-number-ops-unlock="">
                  Unlock first, then tap {op ? CONFIRM[op] : "the button"} again. Your reason is kept.
                </p>
              ) : null}

              {failure ? (
                <div className="flex flex-col gap-ops-2 rounded-lg bg-attention/10 px-ops-3 py-ops-2" role="alert" data-number-ops-error={failure.code ?? ""}>
                  <p className="text-attention">{failure.error}</p>
                  {failure.suggestRestore && op === "lift_quarantine" ? (
                    <div className="flex flex-wrap gap-2">
                      {ops.restore ? (
                        <Button type="button" variant="primary" size="sm" disabled={pending} data-action="number-ops-switch-restore" onClick={() => { setFailure(null); setOp("restore"); }}>
                          Restore to {lastName} instead
                        </Button>
                      ) : null}
                      {failure.needsConfirm ? (
                        <Button type="button" variant="danger" size="sm" pending={pending} disabled={reasonShort} data-action="number-ops-free-anyway" onClick={() => void submit("lift_quarantine", { confirm: true })}>
                          Free it anyway
                        </Button>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </>
          ) : null}
        </div>
      </Drawer>
    </div>
  );
}
