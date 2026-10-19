"use client";

import { useRouter } from "next/navigation";
import { ReasonedSwitch } from "@/components/ReasonedSwitch";
import { ListRow } from "@/components/ui/ListRow";
import { Switch } from "@/components/ui/Switch";
import { requestErrorText } from "@/lib/adminBillingCopy";
import type { BachsStatusView } from "@/lib/adminPayCopy";

function LockedSwitch({ checked, label }: { checked: boolean; label: string }) {
  return <Switch checked={checked} disabled label={label} onCheckedChange={() => undefined} />;
}

/** Bachs status plus the switches an operator can flip. Secrets never reach this screen. */
export function AdminPaymentsStatus({ status }: { status: BachsStatusView }) {
  const router = useRouter();
  const flags = status.dbFlags;
  const signupBlocked = flags.available && !flags.packageEditorEnabled;

  async function saveFlag(flag: "package_editor" | "signup_trial", enabled: boolean, reason: string) {
    const res = await fetch("/api/admin/billing/flags", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ flag, enabled, reason, confirm: true }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) return requestErrorText(json, "That didn't save. Nothing changed.");
    router.refresh();
    return null;
  }

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
                onSave={(next, reason) => saveFlag("package_editor", next, reason)}
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
                onSave={(next, reason) => saveFlag("signup_trial", next, reason)}
              />
            }
          />
        </ul>
      </section>

      <section className="space-y-1">
        <h2 className="px-4 text-caption text-ink-3">Changed in hosting settings</h2>
        <ul className="divide-y divide-hairline/70 border-y border-hairline/70">
          <ListRow
            title="Payments mode"
            preview={status.modeLabel}
            actions={<LockedSwitch checked={status.hosting.modeOn} label="Payments mode" />}
          />
          <ListRow
            title="All live payments"
            preview={status.hosting.liveMasterOn ? "On" : "Off"}
            actions={<LockedSwitch checked={status.hosting.liveMasterOn} label="All live payments" />}
          />
          <ListRow
            title="Billing notices"
            preview={status.hosting.noticesOn ? "On" : "Off"}
            actions={<LockedSwitch checked={status.hosting.noticesOn} label="Billing notices" />}
          />
          <ListRow
            title="Plan changes"
            preview={status.hosting.planChangeOn ? "On" : "Off"}
            actions={<LockedSwitch checked={status.hosting.planChangeOn} label="Plan changes" />}
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
          {status.liveNames.map((name) => (
            <ListRow key={name} title={name} preview="Live payments on" />
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
    </div>
  );
}
