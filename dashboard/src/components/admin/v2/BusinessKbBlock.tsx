"use client";

import { useCallback, useEffect, useState } from "react";
import { OpsConfirm, StatusPill } from "@/components/ops";
import { Button } from "@/components/ui/Button";
import { Switch } from "@/components/ui/Switch";
import { postJson } from "@/lib/ops/archiveRelease";
import type { TakeMessagesState } from "@/lib/takeMessages";

type View = {
  available: boolean;
  liveVersion?: number | null;
  readyVersion?: number | null;
  brainTarget?: "v1" | "v2";
  onNewBrain?: boolean;
  /** Shared isKbLive reason (gate_off | no_facts | held_v1 | no_live_version | never_ready | ready_stale | ready). */
  onNewBrainReason?: string;
  items?: number | null;
  /** "Take messages only" (null = brain_mode SQL not applied here). */
  takeMessages?: TakeMessagesState | null;
  readiness?: { passed: boolean; version: number | null; checkedAt: string; checks: { id: string; ok: boolean; fix?: string | null }[]; tests: { name: string; ok: boolean; heard?: string | null; why?: string | null }[] } | null;
};

const CHECK: Record<string, string> = {
  kb_compiled: "Compiled",
  catalogue: "Prices",
  reader_finds_items: "Lookup",
  areas: "Areas",
  hours: "Hours",
  capture_path: "Capture",
};
const STAMP = new Intl.DateTimeFormat("en-KE", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Africa/Nairobi" });

const MODE_BY: Record<string, string> = {
  owner: "Turned on by the business",
  admin: "Turned on by Scalers support",
  env: "BRAIN_SAFE_MODE=all: every business",
};

/** v2 Knowledge Base readiness for one Business (inside Calls & quality). Check again is safe; the brain switch and Take messages only need Unlock + reason. */
export function BusinessKbBlock({ businessId, fixture }: { businessId: string; fixture?: View }) {
  const [v, setV] = useState<View | null | "error">(fixture ?? null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [confirm, setConfirm] = useState<"v1" | "v2" | null>(null);
  const [modeConfirm, setModeConfirm] = useState<"safe" | "full" | null>(null);
  const load = useCallback(() => {
    if (fixture) return;
    fetch(`/api/admin/businesses/${businessId}/kb`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((j: View) => setV(j))
      .catch(() => setV("error"));
  }, [businessId, fixture]);
  useEffect(() => { if (fixture) return; setV(null); load(); }, [load, fixture]);

  if (v === null) return <p className="text-ops-body text-ink-2">Loading brain…</p>;
  if (v === "error") return <p className="text-ops-body text-ink-2">Couldn&apos;t load the brain status.</p>;
  if (!v.available) return null;

  const r = v.readiness;
  const tm = v.takeMessages ?? null;
  const state = v.onNewBrain ? { tone: "ok" as const, word: "New brain" } : v.brainTarget === "v1" ? { tone: "neutral" as const, word: "Held on old brain" } : v.onNewBrainReason === "gate_off" ? { tone: "neutral" as const, word: "Old brain, KB gate off" } : { tone: "warn" as const, word: "Old brain until checks pass" };
  async function check() {
    setBusy(true); setMsg("");
    const res = await postJson(`/api/admin/businesses/${businessId}/kb`, { action: "check" });
    setBusy(false);
    setMsg(res.ok ? "Checked." : res.error || "Couldn't check. Try again.");
    load();
  }
  async function setMode(mode: "safe" | "full", reason: string) {
    setBusy(true); setMsg("");
    const res = fixture ? { ok: true as const, error: undefined } : await postJson(`/api/admin/businesses/${businessId}/kb`, { action: "set_brain_mode", mode, reason });
    setBusy(false);
    setModeConfirm(null);
    if (fixture && res.ok && v && v !== "error") setV({ ...v, takeMessages: { on: mode === "safe", by: mode === "safe" ? "admin" : null, setAt: new Date().toISOString() } });
    setMsg(res.ok ? "Saved." : res.error === "step_up_required" ? "Unlock first, then try again." : res.error || "Couldn't save. Nothing changed.");
    load();
  }
  async function setTarget(target: "v1" | "v2", reason: string) {
    setBusy(true); setMsg("");
    const res = await postJson(`/api/admin/businesses/${businessId}/kb`, { action: "set_brain_target", target, reason });
    setBusy(false);
    setConfirm(null);
    setMsg(res.ok ? "Saved." : res.error === "step_up_required" ? "Unlock first, then try again." : res.error || "Couldn't save. Nothing changed.");
    load();
  }

  return (
    <div className="flex flex-col gap-ops-2" data-business-kb="">
      <dl className="grid grid-cols-[minmax(7rem,auto)_1fr] gap-x-ops-4 gap-y-ops-1 text-ops-body">
        <dt className="text-ink-2">Brain</dt>
        <dd><StatusPill tone={state.tone}>{state.word}</StatusPill></dd>
        <dt className="text-ink-2">Knowledge</dt>
        <dd className="tabular-nums text-ink">{v.liveVersion != null ? `Version ${v.liveVersion}${v.items != null ? ` · ${v.items} items` : ""}` : "Not compiled"}</dd>
        <dt className="text-ink-2">Readiness</dt>
        <dd className="text-ink">{r ? `${r.passed ? "Passed" : "Not passed"} · ${STAMP.format(new Date(r.checkedAt))}` : "Never checked"}</dd>
        {tm ? (
          <>
            <dt className="flex min-h-11 items-center text-ink-2"><label htmlFor={`take-messages-${businessId}`}>Take messages only</label></dt>
            <dd className="flex flex-wrap items-center gap-x-ops-2" data-admin-take-messages={tm.on ? tm.by || "admin" : "off"}>
              <Switch
                id={`take-messages-${businessId}`}
                label="Take messages only"
                describedBy={`take-messages-${businessId}-note`}
                checked={tm.on}
                disabled={busy || tm.by === "env"}
                onCheckedChange={(next) => setModeConfirm(next ? "safe" : "full")}
              />
              {tm.on ? <StatusPill tone="warn">On</StatusPill> : <StatusPill tone="neutral">Off</StatusPill>}
              <span id={`take-messages-${businessId}-note`} className="text-ops-label text-ink-2">
                {tm.on ? `${MODE_BY[tm.by || "admin"]}${tm.setAt && tm.by !== "env" ? ` · ${STAMP.format(new Date(tm.setAt))}` : ""}` : "Full assistant"}
                {v.onNewBrainReason === "gate_off" ? " · No effect while the KB gate is off" : ""}
              </span>
            </dd>
          </>
        ) : null}
      </dl>
      {r ? (
        <div className="flex flex-wrap gap-1">
          {r.checks.map((c) => <StatusPill key={c.id} tone={c.ok ? "ok" : "danger"}>{CHECK[c.id] || c.id}</StatusPill>)}
          {r.tests.length ? <StatusPill tone={r.tests.every((t) => t.ok) ? "ok" : "danger"}>{`Tests ${r.tests.filter((t) => t.ok).length}/${r.tests.length}`}</StatusPill> : null}
        </div>
      ) : null}
      {r && r.tests.some((t) => !t.ok) ? (
        <ul className="text-ops-label text-ink-2">
          {r.tests.filter((t) => !t.ok).slice(0, 4).map((t) => <li key={t.name}>{t.name}: {t.why || t.heard || "failed"}</li>)}
        </ul>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" variant="ghost" pending={busy} onClick={() => void check()}>Check again</Button>
        {v.brainTarget === "v1" ? (
          <Button type="button" size="sm" variant="ghost" data-action="kb-allow" onClick={() => setConfirm("v2")}>Allow new brain</Button>
        ) : (
          <Button type="button" size="sm" variant="ghost" data-action="kb-hold" onClick={() => setConfirm("v1")}>Hold on old brain</Button>
        )}
      </div>
      {msg ? <p className="text-ops-label text-ink-2" role="status">{msg}</p> : null}
      <OpsConfirm
        open={confirm !== null}
        onClose={() => { if (!busy) setConfirm(null); }}
        onConfirm={(reason) => { if (confirm) void setTarget(confirm, reason); }}
        title={confirm === "v1" ? "Hold this Business on the old brain?" : "Let readiness move this Business?"}
        strength="light"
        requireReason
        confirmLabel={confirm === "v1" ? "Hold on old brain" : "Allow new brain"}
        pending={busy}
      >
        <p>{confirm === "v1" ? "Calls use the old brain from the next call, whatever the checks say." : "Calls use the new brain from the next call once every check passes."} Needs Unlock.</p>
      </OpsConfirm>
      <OpsConfirm
        open={modeConfirm !== null}
        onClose={() => { if (!busy) setModeConfirm(null); }}
        onConfirm={(reason) => { if (modeConfirm) void setMode(modeConfirm, reason); }}
        title={modeConfirm === "safe" ? "Turn on Take messages only?" : "Turn off Take messages only?"}
        strength="light"
        requireReason
        confirmLabel={modeConfirm === "safe" ? "Turn on" : "Turn off"}
        pending={busy}
      >
        <p>{modeConfirm === "safe" ? "From the next call the assistant only takes the caller's name, number and reason. No prices, no booking. The owner sees it was turned on by Scalers support and can't turn it off." : "From the next call the assistant answers questions and books again."} Needs Unlock.</p>
      </OpsConfirm>
    </div>
  );
}
