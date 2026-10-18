"use client";

import { Button } from "@/components/ui/Button";
import { Sheet } from "@/components/ui/Sheet";
import { Switch } from "@/components/ui/Switch";
import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  saveOnDemandUsage,
  type OnDemandUsageState,
} from "@/app/(desk)/wallet/actions";
import { formatKsh } from "@/lib/planPricing";

const initial: OnDemandUsageState = {};

export function OnDemandUsagePanel({
  tenantId,
  enabled: initialEnabled,
  extraMinuteKes = null,
}: {
  tenantId: string;
  enabled: boolean;
  /** Shown once, inside this sheet, and only while extra usage is on. */
  extraMinuteKes?: number | null;
}) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(saveOnDemandUsage, initial);
  const [enabled, setEnabled] = useState(initialEnabled);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setEnabled(initialEnabled);
  }, [initialEnabled]);

  useEffect(() => {
    if (state.ok) router.refresh();
  }, [state.ok, router]);

  const showMinutePrice = enabled && extraMinuteKes != null && extraMinuteKes > 0;

  return (
    <section className="mt-6">
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex min-h-11 w-full items-center justify-between gap-3 rounded-2xl border border-hairline bg-surface px-4 text-start text-body text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
      >
        <span>Extra usage</span>
        <span className="text-ink-2">{initialEnabled ? "On" : "Off"}</span>
      </button>

      <Sheet
        open={open}
        onOpenChange={setOpen}
        title="Extra usage"
        footer={
          <Button
            type="submit"
            form="extra-usage"
            variant="tonal"
            block
            pending={pending}
            disabled={pending || enabled === initialEnabled}
          >
            Save
          </Button>
        }
      >
        <form id="extra-usage" action={formAction}>
          <input type="hidden" name="tenant_id" value={tenantId} />
          <input type="hidden" name="enabled" value={enabled ? "1" : "0"} />
          <div className="flex items-center justify-between gap-3">
            <p className="text-body text-ink">Allow extra usage</p>
            <Switch checked={enabled} label="Allow extra usage" onCheckedChange={setEnabled} />
          </div>
          {showMinutePrice ? (
            <p className="mt-3 text-body text-ink-2">
              Extra minutes are {formatKsh(extraMinuteKes)} each.
            </p>
          ) : null}
          {state.error ? <p className="mt-3 text-body text-attention">{state.error}</p> : null}
          {state.ok ? (
            <p className="mt-3 text-body text-ok">
              {state.enabled ? "Extra usage is on." : "Extra usage is off."}
            </p>
          ) : null}
        </form>
      </Sheet>
    </section>
  );
}
