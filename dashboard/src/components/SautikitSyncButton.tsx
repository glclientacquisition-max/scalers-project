"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function SautikitSyncButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  async function sync() {
    setBusy(true);
    setStatus(null);
    try {
      const res = await fetch("/api/admin/sautikit-sync", { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Sync failed");
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
    <span className="inline-flex items-center gap-3">
      <button
        type="button"
        onClick={sync}
        disabled={busy}
        className="rounded-xl border border-[var(--line)] bg-[var(--card)] px-4 py-2 text-sm font-medium text-[var(--ink)] hover:border-[var(--accent)] disabled:opacity-60"
      >
        {busy ? "Syncing…" : "Sync from SautiKit"}
      </button>
      {status ? <span className="text-xs text-[var(--ink-soft)]">{status}</span> : null}
    </span>
  );
}
