"use client";

import { withRoleGate } from "@/components/DeskRole";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { TenantRow } from "@/lib/supabase";
import { ChevronRightIcon } from "@heroicons/react/20/solid";
import { Sheet } from "@/components/ui/Sheet";
import { Button } from "@/components/ui/Button";
import { PhoneAlertsCard } from "@/components/PhoneAlertsCard";
import { AlertTypeRows } from "@/components/AlertTypeRows";
import {
  SettingsGroup,
  SettingsPageHeader,
  SettingsRow,
  ToolSwitch,
  settingsValueFieldClass,
  settingsFormBodyClass,
} from "@/components/settingsUi";
import {
  parseNotifyChannels,
  type NotifyChannels,
} from "@/lib/notifyChannels";
import {
  saveAlertsAction,
  type AlertsActionState,
} from "@/app/(desk)/settings/alertsActions";
import { TenantSettingsSaveButton } from "@/components/TenantSettingsSaveButton";
import { useFormDraft, useFormSave } from "@/components/useFormSave";
import { useDirty } from "@/lib/settingsDirty";

const initial: AlertsActionState = {};

export const ALERTS_SETTINGS_FORM_ID = "alerts-settings-form";

function AlertsPanelInner({
  tenant,
  businessName,
}: {
  tenant: TenantRow;
  businessName: string;
}) {
  const router = useRouter();
  const [ownerWhatsapp, setOwnerWhatsapp] = useState(
    tenant.whatsapp_notification_number || ""
  );
  const [alertEmail, setAlertEmail] = useState(tenant.alert_email || "");
  const [notifyChannels, setNotifyChannels] = useState<NotifyChannels>(() =>
    parseNotifyChannels(tenant.notify_channels)
  );
  // Shared save pattern: toast, inline Saved, errors with retry, dirty and guard.
  const save = useFormSave({
    action: saveAlertsAction,
    initialState: initial,
    successMessage: "Saved",
    formId: ALERTS_SETTINGS_FORM_ID,
    // Stored phone is E.164: refetch so the fields show what was written.
    onSaved: () => router.refresh(),
  });
  const { pending } = save;
  const alertDraft = { ownerWhatsapp, alertEmail, notifyChannels };
  const { dirty, justSaved, markClean } = useFormDraft(save, {
    id: "alerts",
    values: alertDraft,
  });
  const [alertSnapshot] = useState(alertDraft);
  const counted = useDirty(alertSnapshot, alertDraft);
  const changes = dirty ? counted : 0;
  const [contactEdit, setContactEdit] = useState<null | "phone" | "email">(null);
  const paused = !notifyChannels.sms && !notifyChannels.whatsapp && !notifyChannels.email;
  const included = Number(tenant.sms_included_units);
  const used = Number(tenant.sms_used_units ?? 0);
  const creditLine =
    Number.isFinite(included) && included > 0
      ? `Uses message credits. ${used} of ${included} used.`
      : "Uses message credits.";

  useEffect(() => {
    const phone = tenant.whatsapp_notification_number || "";
    const email = tenant.alert_email || "";
    const channels = parseNotifyChannels(tenant.notify_channels);
    setOwnerWhatsapp(phone);
    setAlertEmail(email);
    setNotifyChannels(channels);
    markClean({ ownerWhatsapp: phone, alertEmail: email, notifyChannels: channels });
    // markClean changes with the draft; only a new stored row should reset it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    tenant.whatsapp_notification_number,
    tenant.alert_email,
    tenant.notify_channels,
  ]);

  return (
    <section className="min-w-0 w-full space-y-6">
      <SettingsPageHeader
        businessName={businessName}
        lineLive={false}
        showBack
        title="How we notify"
        alert={save.error}
        onRetry={save.retry}
        action={
          <TenantSettingsSaveButton
            form={ALERTS_SETTINGS_FORM_ID}
            pending={pending}
            saved={justSaved}
            changes={changes}
          />
        }
      />
      <form
        id={ALERTS_SETTINGS_FORM_ID}
        onSubmit={save.onSubmit}
        className={`${settingsFormBodyClass} space-y-6`}
      >
        <input type="hidden" name="tenant_id" value={tenant.id} />
        <input
          type="hidden"
          name="whatsapp_notification_number"
          value={ownerWhatsapp}
        />
        <input type="hidden" name="alert_email" value={alertEmail} />
        <input
          type="hidden"
          name="notify_channels"
          value={JSON.stringify(notifyChannels)}
        />

        <SettingsGroup title="Contact">
          <button
            type="button"
            onClick={() => setContactEdit("phone")}
            className="flex min-h-14 w-full items-center gap-3 px-4 py-2 text-start hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand"
          >
            <span className="min-w-0 flex-1">
              <span className="block text-body text-ink">Alert phone</span>
              <span className="block truncate text-meta text-ink-2">{ownerWhatsapp || "Add a phone"}</span>
            </span>
            <ChevronRightIcon className="size-5 shrink-0 text-ink-3" aria-hidden />
          </button>
          <button
            type="button"
            onClick={() => setContactEdit("email")}
            className="flex min-h-14 w-full items-center gap-3 border-t border-hairline px-4 py-2 text-start hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand"
          >
            <span className="min-w-0 flex-1">
              <span className="block text-body text-ink">Email</span>
              <span className="block truncate text-meta text-ink-2">{alertEmail || "Add an email"}</span>
            </span>
            <ChevronRightIcon className="size-5 shrink-0 text-ink-3" aria-hidden />
          </button>
        </SettingsGroup>

        <SettingsGroup>
          <SettingsRow label="Pause all alerts" control="switch">
            <ToolSwitch
              checked={paused}
              label="Pause all alerts"
              onChange={(next) =>
                setNotifyChannels({
                  ...notifyChannels,
                  sms: !next,
                  whatsapp: !next,
                  email: !next,
                })
              }
            />
          </SettingsRow>
        </SettingsGroup>

        <AlertTypeRows value={notifyChannels} onChange={setNotifyChannels} />

        <SettingsGroup title="Callers">
          <SettingsRow label="Text customers" control="switch">
            <ToolSwitch
              checked={Boolean(notifyChannels.caller_sms)}
              onChange={(next) =>
                setNotifyChannels({ ...notifyChannels, caller_sms: next })
              }
              label="Text customers"
            />
          </SettingsRow>
          <p className="px-4 pb-3 text-meta text-ink-2">Texts the caller from the desk. {creditLine}</p>
          <SettingsRow label="Text back missed calls" control="switch">
            <ToolSwitch
              checked={Boolean(notifyChannels.missed_textback)}
              onChange={(next) =>
                setNotifyChannels({ ...notifyChannels, missed_textback: next })
              }
              label="Text back missed calls"
            />
          </SettingsRow>
          <p className="px-4 pb-3 text-meta text-ink-2">Texts a caller you missed. {creditLine}</p>
        </SettingsGroup>

        <PhoneAlertsCard />

        <Sheet
          open={contactEdit != null}
          onOpenChange={(next) => {
            if (!next) setContactEdit(null);
          }}
          title={contactEdit === "email" ? "Email" : "Alert phone"}
          footer={
            <Button type="button" onClick={() => setContactEdit(null)}>
              Done
            </Button>
          }
        >
          {contactEdit === "email" ? (
            <label className="block text-meta text-ink-2" htmlFor="alert_email">
              Email
              <input
                id="alert_email"
                type="email"
                value={alertEmail}
                onChange={(e) => setAlertEmail(e.target.value)}
                placeholder="owner@shop.co.ke"
                className={`${settingsValueFieldClass} mt-1 w-full`}
              />
            </label>
          ) : (
            <label className="block text-meta text-ink-2" htmlFor="owner">
              Alert phone
              <input
                id="owner"
                value={ownerWhatsapp}
                onChange={(e) => setOwnerWhatsapp(e.target.value)}
                placeholder="+254 700 000 000"
                className={`${settingsValueFieldClass} mt-1 w-full`}
              />
            </label>
          )}
        </Sheet>
      </form>
    </section>
  );
}

export const AlertsPanel = withRoleGate("settings.edit", AlertsPanelInner);
