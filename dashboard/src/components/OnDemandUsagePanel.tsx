"use client";

import { Button } from "@/components/ui/Button";
import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  saveOnDemandUsage,
  type OnDemandUsageState,
} from "@/app/(desk)/wallet/actions";
import { pendingSpinnerClass } from "@/components/ui/deskChrome";

const initial: OnDemandUsageState = {};

export function OnDemandUsagePanel({
  tenantId,
  enabled: initialEnabled,
}: {
  tenantId: string;
  enabled: boolean;
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
    <section>
      <h2 className="font-display text-title tracking-tight text-ink">On-demand</h2>

      <form action={formAction} data-pull-dirty-guard="" className="mt-3 space-y-4">
        <input type="hidden" name="tenant_id" value={tenantId} />
        <input type="hidden" name="enabled" value={enabled ? "1" : "0"} />

        <label className="flex min-h-11 items-center gap-3 text-body">
          <input
            type="checkbox"
            className="h-5 w-5"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
          />
          <span className="text-ink">
            Charge on-demand rates for minutes and SMS past included
          </span>
        </label>

        {state.error ? <p className="text-body text-warn">{state.error}</p> : null}
        {state.ok ? (
          <p className="text-body text-ok">
            {state.enabled ? "On-demand enabled." : "On-demand disabled."}
          </p>
        ) : null}

        <Button
          type="submit"
          disabled={pending}
         
         className="gap-2">
          {pending ? (
            <>
              <span aria-hidden="true" className={pendingSpinnerClass} />
              Saving
            </>
          ) : (
            "Save"
          )}
        </Button>
      </form>
    </section>
  );
}
