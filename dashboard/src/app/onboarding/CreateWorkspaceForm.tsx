"use client";

import { useActionState } from "react";
import { createWorkspaceForSessionAction, type CreateWorkspaceState } from "./createWorkspaceAction";
import { btnPrimary, deskFieldClass, pendingSpinnerClass } from "@/components/ui/deskChrome";

const initial: CreateWorkspaceState = {};

export function CreateWorkspaceForm() {
  const [state, formAction, pending] = useActionState(createWorkspaceForSessionAction, initial);
  return (
    <form action={formAction} className="mt-6 space-y-4 rounded-panel border border-line glass-chrome p-6">
      <div>
        <label className="block text-sm font-medium text-ink" htmlFor="business_name">
          Business name
        </label>
        <input id="business_name" name="business_name" required maxLength={120} autoFocus className={`mt-2 ${deskFieldClass}`} />
      </div>
      <div>
        <label className="block text-sm font-medium text-ink" htmlFor="notification_phone">
          Phone for alerts
        </label>
        <input id="notification_phone" name="notification_phone" type="tel" required inputMode="tel" className={`mt-2 ${deskFieldClass}`} placeholder="0712 345 678" />
      </div>
      {state.error ? (
        <p role="alert" className="text-sm text-warn">{state.error}</p>
      ) : null}
      <button type="submit" disabled={pending} className={btnPrimary}>
        {pending ? <span className={pendingSpinnerClass} aria-hidden /> : null}
        Create workspace
      </button>
    </form>
  );
}
