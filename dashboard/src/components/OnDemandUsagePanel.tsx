"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  saveOnDemandUsage,
  type OnDemandUsageState,
} from "@/app/(desk)/wallet/actions";

const initial: OnDemandUsageState = {};

export function OnDemandUsagePanel({
  tenantId,
  enabled: initialEnabled,
  isBeta,
}: {
  tenantId: string;
  enabled: boolean;
  isBeta: boolean;
}) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(saveOnDemandUsage, initial);
  const [enabled, setEnabled] = useState(initialEnabled);

  useEffect(() => {
    setEnabled(initialEnabled);
  }, [initialEnabled]);

  useEffect(() => {
    if (state.ok) router.refresh();
  }, [state.ok, router]);

  return (
    <section className="rounded-2xl border border-line bg-surface p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-xl tracking-tight text-ink">On-demand usage</h2>
        <span className="rounded-full border border-line px-3 py-1 text-xs font-medium text-ink-soft">
          {enabled ? "On" : "Off"}
        </span>
      </div>

      <form action={formAction} className="mt-4 space-y-4">
        <input type="hidden" name="tenant_id" value={tenantId} />
        <input type="hidden" name="enabled" value={enabled ? "1" : "0"} />

        <label className="flex items-start gap-3 text-sm">
          <input
            type="checkbox"
            className="mt-1"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            disabled={isBeta}
          />
          <span className="text-ink">
            Continue answering after prepaid hits zero
          </span>
        </label>

        {state.error ? <p className="text-sm text-warn">{state.error}</p> : null}
        {state.ok ? (
          <p className="text-sm text-ok">
            {state.enabled ? "On-demand enabled." : "On-demand disabled."}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={pending || isBeta}
          className="rounded-xl border border-line px-4 py-2.5 text-sm font-medium text-ink transition hover:border-[#0096FF]/45 hover:text-[#005ccc] disabled:opacity-60"
        >
          {pending ? "Saving…" : "Save"}
        </button>
      </form>
    </section>
  );
}
