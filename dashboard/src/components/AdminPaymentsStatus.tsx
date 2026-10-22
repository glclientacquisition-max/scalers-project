"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ReasonedSwitch } from "@/components/ReasonedSwitch";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Field";
import { ListRow } from "@/components/ui/ListRow";
import { Segmented } from "@/components/ui/Segmented";
import { Sheet } from "@/components/ui/Sheet";
import { requestErrorText } from "@/lib/adminBillingCopy";
import type { BachsStatusView } from "@/lib/adminPayCopy";

type BachsMode = "off" | "sandbox" | "live";

async function postFlag(body: Record<string, unknown>): Promise<string | null> {
  const res = await fetch("/api/admin/billing/flags", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) return requestErrorText(json, "That didn't save. Nothing changed.");
  return null;
}

/** Bachs status plus switches an operator can flip. Keys and secrets stay in hosting. */
export function AdminPaymentsStatus({ status }: { status: BachsStatusView }) {
  const router = useRouter();
  const flags = status.dbFlags;
  const signupBlocked = flags.available && !flags.packageEditorEnabled;
  const runtimeReady = status.runtimeControlsAvailable;

  const [modeSheet, setModeSheet] = useState(false);
  const [nextMode, setNextMode] = useState<BachsMode>("off");
  const [modeReason, setModeReason] = useState("");
  const [modeError, setModeError] = useState<string | null>(null);
  const [modePending, setModePending] = useState(false);

  async function saveDbFlag(flag: "package_editor" | "signup_trial", enabled: boolean, reason: string) {
    return postFlag({ flag, enabled, reason, confirm: true });
  }

  async function saveRuntimeFlag(
    flag: "live_master" | "billing_notices" | "desk_plan_change",
    enabled: boolean,
    reason: string,
  ) {
    return postFlag({ flag, enabled, reason, confirm: true });
  }

  function openModeSheet() {
    const raw = status.modeLabel.toLowerCase();
    const current: BachsMode =
      raw === "live" ? "live" : raw === "sandbox" ? "sandbox" : "off";
    setNextMode(current);
    setModeReason("");
    setModeError(null);
    setModeSheet(true);
  }

  async function saveMode() {
    if (modeReason.trim().length < 3) {
      setModeError("Add a reason (3 letters or more).");
      return;
    }
    setModePending(true);
    setModeError(null);
    const problem = await postFlag({
      flag: "bachs_mode",
      mode: nextMode,
      reason: modeReason.trim(),
      confirm: true,
    });
    setModePending(false);
    if (problem) {
      setModeError(problem);
      return;
    }
    setModeSheet(false);
    router.refresh();
  }

  const runtimeDisabledHint = runtimeReady ? undefined : "Not on this database.";

  return (
    <div className="space-y-8">
      <section className="space-y-1">
        <h2 className="px-4 text-caption text-ink-3">Settings</h2>
        <ul className="divide-y divide-hairline/70 border-y border-hairline/70">
          <ListRow
            title="Package editor"
            preview={flags.available ? (flags.packageEditorEnabled ? "On" : "Off") : "Not on this database."}
            actions={
              <ReasonedSwitch
                checked={flags.packageEditorEnabled}
                disabled={!flags.available}
                label="Package editor"
                title={(next) => (next ? "Turn the package editor on?" : "Turn the package editor off?")}
                explain={(next) =>
                  next
                    ? "Staff can draft and publish packages."
                    : "Drafts and publishes stop. Signup trial changes stop until the editor is on again."
                }
                confirmLabel={(next) => (next ? "Turn on" : "Turn off")}
                onSave={(next, reason) => saveDbFlag("package_editor", next, reason)}
              />
            }
          />
          <ListRow
            title="Signup trial"
            preview={
              !flags.available
                ? "Not on this database."
                : signupBlocked
                  ? "The package editor is off."
                  : flags.signupTrialEnabled
                    ? "On"
                    : "Off"
            }
            actions={
              <ReasonedSwitch
                checked={flags.signupTrialEnabled}
                disabled={!flags.available || signupBlocked}
                label="Signup trial"
                title={(next) => (next ? "Turn the signup trial on?" : "Turn the signup trial off?")}
                explain={(next) =>
                  next ? "A new business starts on a trial." : "A new business does not start on a trial."
                }
                confirmLabel={(next) => (next ? "Turn on" : "Turn off")}
                onSave={(next, reason) => saveDbFlag("signup_trial", next, reason)}
              />
            }
          />
        </ul>
      </section>

      <section className="space-y-1">
        <h2 className="px-4 text-caption text-ink-3">Checkout</h2>
        <ul className="divide-y divide-hairline/70 border-y border-hairline/70">
          <ListRow
            title="Payments mode"
            preview={runtimeReady ? status.modeLabel : runtimeDisabledHint ?? status.modeLabel}
            actions={
              <Button variant="tonal" size="sm" disabled={!runtimeReady} onClick={openModeSheet}>
                Change
              </Button>
            }
          />
          <ListRow
            title="All live payments"
            preview={
              runtimeReady
                ? status.hosting.liveMasterOn
                  ? "On"
                  : "Off"
                : runtimeDisabledHint ?? (status.hosting.liveMasterOn ? "On" : "Off")
            }
            actions={
              <ReasonedSwitch
                checked={status.hosting.liveMasterOn}
                disabled={!runtimeReady}
                label="All live payments"
                title={(next) => (next ? "Turn live payments on?" : "Turn live payments off?")}
                explain={(next) =>
                  next
                    ? "Live checkout can run when mode is live and a business is allowed."
                    : "Live checkout stops for every business until you turn this on again."
                }
                confirmLabel={(next) => (next ? "Turn on" : "Turn off")}
                onSave={(next, reason) => saveRuntimeFlag("live_master", next, reason)}
              />
            }
          />
          <ListRow
            title="Billing notices"
            preview={
              runtimeReady
                ? status.hosting.noticesOn
                  ? "On"
                  : "Off"
                : runtimeDisabledHint ?? (status.hosting.noticesOn ? "On" : "Off")
            }
            actions={
              <ReasonedSwitch
                checked={status.hosting.noticesOn}
                disabled={!runtimeReady}
                label="Billing notices"
                title={(next) => (next ? "Turn billing notices on?" : "Turn billing notices off?")}
                explain={(next) =>
                  next ? "Billing notices can send." : "Billing notices stay queued and do not send."
                }
                confirmLabel={(next) => (next ? "Turn on" : "Turn off")}
                onSave={(next, reason) => saveRuntimeFlag("billing_notices", next, reason)}
              />
            }
          />
          <ListRow
            title="Plan changes"
            preview={
              runtimeReady
                ? status.hosting.planChangeOn
                  ? "On"
                  : "Off"
                : runtimeDisabledHint ?? (status.hosting.planChangeOn ? "On" : "Off")
            }
            actions={
              <ReasonedSwitch
                checked={status.hosting.planChangeOn}
                disabled={!runtimeReady}
                label="Plan changes"
                title={(next) => (next ? "Turn owner plan changes on?" : "Turn owner plan changes off?")}
                explain={(next) =>
                  next ? "Owners can change plan when Desk ships the port." : "Owner plan change stays closed."
                }
                confirmLabel={(next) => (next ? "Turn on" : "Turn off")}
                onSave={(next, reason) => saveRuntimeFlag("desk_plan_change", next, reason)}
              />
            }
          />
        </ul>
      </section>

      <section className="space-y-1">
        <h2 className="px-4 text-caption text-ink-3">Bachs</h2>
        <ul className="divide-y divide-hairline/70 border-y border-hairline/70">
          <ListRow title="Key" preview={status.keySet} />
          <ListRow title="Webhook secret" preview={status.webhookSecretSet} />
        </ul>
      </section>
      <section className="space-y-1">
        <h2 className="px-4 text-caption text-ink-3">Live businesses</h2>
        <ul className="divide-y divide-hairline/70 border-y border-hairline/70">
          <ListRow title="Allowed" preview={status.liveSummary} />
          {status.liveRows.map((row) => (
            <ListRow key={row.id} title={row.name} preview={row.preview} />
          ))}
        </ul>
      </section>
      <section className="space-y-1">
        <h2 className="px-4 text-caption text-ink-3">Webhooks</h2>
        <ul className="divide-y divide-hairline/70 border-y border-hairline/70">
          <ListRow title="Last received" preview={status.lastWebhook} />
          <ListRow title="Last 24 hours" preview={status.webhooks24h} />
        </ul>
      </section>
      <section className="space-y-1">
        <h2 className="px-4 text-caption text-ink-3">Reconcile</h2>
        {status.reconcileAvailable ? (
          status.reconcile.length === 0 ? (
            <p className="px-4 py-3 text-body text-ink-2">No mismatches.</p>
          ) : (
            <ul className="divide-y divide-hairline/70 border-y border-hairline/70">
              {status.reconcile.map((row) => (
                <ListRow key={row.label} title={row.label} preview={String(row.count)} />
              ))}
            </ul>
          )
        ) : (
          <p className="px-4 py-3 text-body text-ink-2">Not on this database.</p>
        )}
      </section>

      <Sheet
        open={modeSheet}
        title="Payments mode"
        theme="admin"
        onOpenChange={(open) => {
          if (!open && !modePending) setModeSheet(false);
        }}
        footer={
          <Button variant="primary" size="md" pending={modePending} onClick={() => void saveMode()}>
            Save
          </Button>
        }
      >
        {modeError ? (
          <p className="pb-3 text-body text-attention" role="alert">
            {modeError}
          </p>
        ) : null}
        <Segmented
          label="Mode"
          items={[
            { key: "off", label: "Off", active: nextMode === "off" },
            { key: "sandbox", label: "Sandbox", active: nextMode === "sandbox" },
            { key: "live", label: "Live", active: nextMode === "live" },
          ]}
          onSelect={(key) => setNextMode(key as BachsMode)}
        />
        <Field id="payments-mode-reason" label="Reason" required className="pt-4">
          {(props) => (
            <Input {...props} value={modeReason} onChange={(event) => setModeReason(event.target.value)} />
          )}
        </Field>
      </Sheet>
    </div>
  );
}
