"use client";

import { withRoleGate } from "@/components/DeskRole";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { TenantRow } from "@/lib/supabase";
import { NotifyChannelPicker } from "@/components/NotifyChannelPicker";
import { PhoneAlertsCard } from "@/components/PhoneAlertsCard";
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
  const { justSaved, markClean } = useFormDraft(save, {
    id: "alerts",
    values: { ownerWhatsapp, alertEmail, notifyChannels },
  });

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
          <SettingsRow label="Alert phone" htmlFor="owner">
            <input
              id="owner"
              value={ownerWhatsapp}
              onChange={(e) => setOwnerWhatsapp(e.target.value)}
              placeholder="+254 700 000 000"
              className={settingsValueFieldClass}
            />
          </SettingsRow>
          <SettingsRow label="Email" htmlFor="alert_email">
            <input
              id="alert_email"
              type="email"
              value={alertEmail}
              onChange={(e) => setAlertEmail(e.target.value)}
              placeholder="owner@shop.co.ke"
              className={settingsValueFieldClass}
            />
          </SettingsRow>
        </SettingsGroup>

        <NotifyChannelPicker
          value={notifyChannels}
          onChange={setNotifyChannels}
          heading="Channels"
        />

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
          <SettingsRow label="Text back missed calls" control="switch">
            <ToolSwitch
              checked={Boolean(notifyChannels.missed_textback)}
              onChange={(next) =>
                setNotifyChannels({ ...notifyChannels, missed_textback: next })
              }
              label="Text back missed calls"
            />
          </SettingsRow>
        </SettingsGroup>
      </form>
      <div className={`${settingsFormBodyClass} mt-6`}>
        <PhoneAlertsCard />
      </div>
    </section>
  );
}

export const AlertsPanel = withRoleGate("settings.edit", AlertsPanelInner);
