"use client";

import { useState } from "react";
import type { OpsNotice, OpsSettings, OpsSignal } from "@/lib/platformOpsModel";
import { PageHeader, StatusPill, type OpsTone } from "@/components/ops";
import { Button } from "@/components/ui/Button";
import "@/styles/ops.css";

type InfraRow = { id: string; title: string; tone: "ok" | "attention" | "neutral"; label: string; detail: string };

type Snapshot = {
  settings: OpsSettings;
  persisted: boolean;
  signals: OpsSignal[];
  strip: { tone: "ok" | "attention" | "down"; label: string };
  notices: OpsNotice[];
  infra: InfraRow[];
  mailConfigured: boolean;
};

function signalTone(s: OpsSignal): OpsTone {
  if (!s.active) return "ok";
  return s.critical ? "danger" : "warn";
}

function stripTone(t: Snapshot["strip"]["tone"]): OpsTone {
  if (t === "ok") return "ok";
  if (t === "attention") return "warn";
  return "danger";
}

function infraTone(t: InfraRow["tone"]): OpsTone {
  if (t === "ok") return "ok";
  if (t === "attention") return "warn";
  return "neutral";
}

/**
 * Services (ADMIN_V2): health, open notices, who to alert — definition cards.
 * View-only; Unlock for edits that wait on step-up. No dead switches.
 */
export function AdminServicesV2({ snapshot }: { snapshot: Snapshot }) {
  const [note, setNote] = useState(false);
  const open = snapshot.notices.filter((n) => n.status === "open");
  const people = snapshot.settings.people;
  return (
    <div className="ops-theme flex w-full flex-col gap-ops-3 pe-ops-4 text-ops-body">
      <PageHeader
        title="Services"
        actions={
          <Button type="button" variant="primary" size="sm" onClick={() => setNote(true)}>
            Unlock to edit
          </Button>
        }
      />
      <p className="flex flex-wrap items-center justify-between gap-2 text-ops-label text-ink-2">
        <StatusPill tone={stripTone(snapshot.strip.tone)}>{snapshot.strip.label}</StatusPill>
        <span>View only · unlock to change</span>
      </p>
      {note ? (
        <p className="rounded-sm border border-hairline bg-canvas px-ops-3 py-ops-2 text-ops-label text-ink-2" role="status">
          Secure sign-in is next. Changing alerts or retention waits for step-up — this button does not change them yet.{" "}
          <button type="button" className="font-semibold text-ink underline-offset-2 hover:underline" onClick={() => setNote(false)}>
            Dismiss
          </button>
        </p>
      ) : null}

      <article className="overflow-hidden rounded-sm border border-hairline bg-surface">
        <header className="flex justify-between border-b border-hairline px-ops-3 py-ops-2">
          <h2 className="font-semibold text-ink">Health</h2>
          <span className="text-ops-label text-ink-2">{snapshot.signals.filter((s) => s.active).length} active</span>
        </header>
        <ul className="divide-y divide-hairline">
          {snapshot.signals.map((s) => (
            <li key={s.kind} className="flex flex-wrap items-baseline justify-between gap-2 px-ops-3 py-ops-2">
              <span className="font-semibold text-ink">{s.title}</span>
              <StatusPill tone={signalTone(s)}>{s.active ? (s.critical ? "Critical" : "Attention") : "Clear"}</StatusPill>
              <span className="w-full text-ops-label text-ink-2">{s.detail}</span>
            </li>
          ))}
        </ul>
      </article>

      <article className="overflow-hidden rounded-sm border border-hairline bg-surface">
        <header className="flex justify-between border-b border-hairline px-ops-3 py-ops-2">
          <h2 className="font-semibold text-ink">Open notices</h2>
          <span className="text-ops-label text-ink-2">{open.length}</span>
        </header>
        {open.length === 0 ? (
          <p className="px-ops-3 py-ops-3 text-ink-2">None open.</p>
        ) : (
          <ul className="divide-y divide-hairline">
            {open.map((n) => (
              <li key={n.id} className="px-ops-3 py-ops-2">
                <span className="font-semibold text-ink">{n.kind}</span>
                <span className="mt-0.5 block text-ops-label text-ink-2">{n.detail || "No detail"}</span>
              </li>
            ))}
          </ul>
        )}
      </article>

      <article className="overflow-hidden rounded-sm border border-hairline bg-surface">
        <header className="flex justify-between border-b border-hairline px-ops-3 py-ops-2">
          <h2 className="font-semibold text-ink">Who to alert</h2>
          <span className="text-ops-label text-ink-2">{snapshot.mailConfigured ? "Mail ready" : "Mail not configured"}</span>
        </header>
        <dl>
          {(people.length ? people : [{ id: "none", name: "No one listed", phone: "", email: "" }]).map((p) => (
            <div
              key={p.id}
              className="grid grid-cols-1 gap-0.5 border-b border-hairline px-ops-3 py-ops-2 last:border-b-0 md:grid-cols-[12rem_1fr] md:gap-ops-4"
            >
              <dt className="font-semibold text-ink">{p.name || "Person"}</dt>
              <dd className="text-ops-label text-ink-2">{[p.email, p.phone].filter(Boolean).join(" · ") || "—"}</dd>
            </div>
          ))}
          <div className="grid grid-cols-1 gap-0.5 px-ops-3 py-ops-2 md:grid-cols-[12rem_1fr] md:gap-ops-4">
            <dt className="text-ink-2">Recording retention</dt>
            <dd className="font-semibold tabular-nums text-ink">
              {snapshot.settings.recordingRetentionDays == null
                ? "Host default"
                : snapshot.settings.recordingRetentionDays < 0
                  ? "Never delete"
                  : `${snapshot.settings.recordingRetentionDays} days`}
            </dd>
          </div>
        </dl>
      </article>

      <article className="overflow-hidden rounded-sm border border-hairline bg-surface">
        <header className="border-b border-hairline px-ops-3 py-ops-2">
          <h2 className="font-semibold text-ink">Reachability</h2>
        </header>
        <ul className="divide-y divide-hairline">
          {snapshot.infra.map((row) => (
            <li key={row.id} className="flex flex-wrap items-baseline justify-between gap-2 px-ops-3 py-ops-2">
              <span className="font-semibold text-ink">{row.title}</span>
              <StatusPill tone={infraTone(row.tone)}>{row.label}</StatusPill>
              <span className="w-full text-ops-label text-ink-2">{row.detail}</span>
            </li>
          ))}
        </ul>
      </article>
    </div>
  );
}
