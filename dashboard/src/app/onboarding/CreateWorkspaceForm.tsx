"use client";

import { useActionState } from "react";
import { createWorkspaceForSessionAction, type CreateWorkspaceState } from "./createWorkspaceAction";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Field";

const initial: CreateWorkspaceState = {};

export function CreateWorkspaceForm() {
  const [state, formAction, pending] = useActionState(createWorkspaceForSessionAction, initial);
  return (
    <form action={formAction} className="mt-6 space-y-4 rounded-2xl bg-surface p-4 sm:p-6">
      <Field id="business_name" label="Business name">
        {(p) => <Input {...p} name="business_name" required maxLength={120} autoFocus autoComplete="organization" />}
      </Field>
      <Field id="notification_phone" label="Mobile number for alerts">
        {(p) => (
          <Input {...p} name="notification_phone" type="tel" required inputMode="tel" autoComplete="tel" placeholder="e.g. 0712 345 678" />
        )}
      </Field>
      {state.error ? (
        <p role="alert" className="text-meta text-attention">
          {state.error}
        </p>
      ) : null}
      <Button type="submit" variant="primary" size="lg" block pending={pending}>
        Create workspace
      </Button>
    </form>
  );
}
