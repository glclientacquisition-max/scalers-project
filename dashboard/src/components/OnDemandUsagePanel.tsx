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
  hint,
  locked = false,
}: {
  tenantId: string;
  enabled: boolean;
  /** What the saved setting means right now (billing mode aware). */
  hint?: string | null;
  /** Trial keeps on-demand off. Display only. */
  locked?: boolean;
}) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(saveOnDemandUsage, initial);
  const [enabled, setEnabled] = useState(locked ? false : initialEnabled);

  useEffect(() => {
    setEnabled(initialEnabled);
  }, [initialEnabled]);

  useEffect(() => {
    if (state.ok) router.refresh();
  }, [state.ok, router]);

  return (
    <section>
      <h2 className="font-display text-title tracking-tight text-ink">Extra usage</h2>
      {hint ? <p className="mt-1 text-body text-ink-2">{hint}</p> : null}

      <form action={formAction} data-pull-dirty-guard="" className="mt-3 space-y-4">
        <input type="hidden" name="tenant_id" value={tenantId} />
        <input type="hidden" name="enabled" value={enabled ? "1" : "0"} />

        <label className="flex min-h-11 items-center gap-3 text-body">
          <input
            type="checkbox"
            className="h-5 w-5"
            checked={locked ? false : enabled}
            disabled={locked}
            onChange={(e) => setEnabled(e.target.checked)}
          />
          <span className="text-ink">
            Allow calls and SMS past what&apos;s included, at the rates below
          </span>
        </label>
        {locked ? <p className="text-body text-ink-2">On-demand stays off until the trial ends.</p> : null}

        {state.error ? <p className="text-body text-warn">{state.error}</p> : null}
        {state.ok ? (
          <p className="text-body text-ok">
            {state.enabled ? "Extra usage is on." : "Extra usage is off."}
          </p>
        ) : null}

        <Button
          type="submit"
          disabled={locked || pending || enabled === initialEnabled}
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
