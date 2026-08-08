"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type SyncDiagnostics = {
  configured?: boolean;
  startsWithEyJ?: boolean;
  length?: number;
  label?: string | null;
  scopes?: string[];
  fingerprint?: string | null;
  issues?: string[];
};

export function SautikitSyncButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [diagnostics, setDiagnostics] = useState<SyncDiagnostics | null>(null);

  async function sync() {
    setBusy(true);
    setStatus(null);
    setDiagnostics(null);
    try {
      const res = await fetch("/api/admin/sautikit-sync", { method: "POST" });
      const json = await res.json();
      if (!res.ok) {
        if (json.diagnostics) setDiagnostics(json.diagnostics);
        throw new Error(json.error || "Sync failed");
      }
      const added = json.added?.length || 0;
      const linked = json.linked?.length || 0;
      setStatus(
        added || linked
          ? `Synced: ${added} added, ${linked} linked.`
          : "Pool already matches your SautiKit account."
      );
      router.refresh();
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Sync failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="inline-flex flex-col items-end gap-2 max-w-md">
      <span className="inline-flex items-center gap-3">
        <button
          type="button"
          onClick={sync}
          disabled={busy}
          className="rounded-xl border border-[var(--line)] bg-[var(--card)] px-4 py-2 text-sm font-medium text-[var(--ink)] hover:border-[var(--accent)] disabled:opacity-60"
        >
          {busy ? "Syncing…" : "Sync from SautiKit"}
        </button>
        {status ? <span className="text-xs text-[var(--ink-soft)] text-right">{status}</span> : null}
      </span>
      {diagnostics ? (
        <p className="text-[11px] text-[var(--ink-soft)] text-right leading-relaxed">
          Server key: label “{diagnostics.label || "-"}”, length {diagnostics.length ?? "-"},
          eyJ={diagnostics.startsWithEyJ ? "yes" : "no"}
          {diagnostics.fingerprint ? `, ${diagnostics.fingerprint}` : ""}
          {diagnostics.scopes?.length ? ` · ${diagnostics.scopes.join(", ")}` : ""}
        </p>
      ) : null}
    </div>
  );
}
