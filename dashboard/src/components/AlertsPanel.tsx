"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { TenantRow } from "@/lib/supabase";
import { NotifyChannelPicker } from "@/components/NotifyChannelPicker";
import {
  SettingsGroup,
  SettingsPageHeader,
  SettingsRow,
  ToolSwitch,
  settingsDenseFieldClass,
  settingsPrimaryButtonClass,
} from "@/components/settingsUi";
import {
  parseNotifyChannels,
  type NotifyChannels,
} from "@/lib/notifyChannels";
import {
  saveAlertsAction,
  type AlertsActionState,
} from "@/app/(desk)/settings/alertsActions";

const initial: AlertsActionState = {};

export const ALERTS_SETTINGS_FORM_ID = "alerts-settings-form";

export function AlertsPanel({
  tenant,
  businessName,
  lineLive,
  lineDetail,
}: {
  tenant: TenantRow;
  businessName: string;
  lineLive: boolean;
  lineDetail: string;
}) {
  const router = useRouter();
  const [ownerWhatsapp, setOwnerWhatsapp] = useState(
    tenant.whatsapp_notification_number || ""
  );
  const [alertEmail, setAlertEmail] = useState(tenant.alert_email || "");
  const [notifyChannels, setNotifyChannels] = useState<NotifyChannels>(() =>
    parseNotifyChannels(tenant.notify_channels)
  );
  const [state, formAction, pending] = useActionState(saveAlertsAction, initial);

  useEffect(() => {
    setOwnerWhatsapp(tenant.whatsapp_notification_number || "");
    setAlertEmail(tenant.alert_email || "");
    setNotifyChannels(parseNotifyChannels(tenant.notify_channels));
  }, [
    tenant.whatsapp_notification_number,
    tenant.alert_email,
    tenant.notify_channels,
  ]);

  useEffect(() => {
    if (state.ok) router.refresh();
  }, [state, router]);

  const flash = state.error || state.message;
  const flashIsError = Boolean(state.error);

  return (
    <section className="min-w-0 w-full space-y-6">
      <SettingsPageHeader
        businessName={businessName}
        lineLive={lineLive}
        lineDetail={lineDetail}
        showBack
        title="Alerts"
        action={
          <button
            type="submit"
            form={ALERTS_SETTINGS_FORM_ID}
            disabled={pending}
            className={settingsPrimaryButtonClass}
          >
            {pending ? "Saving…" : "Save"}
          </button>
        }
      />
      <form
        id={ALERTS_SETTINGS_FORM_ID}
        action={formAction}
        className="min-w-0 space-y-6"
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
              className={settingsDenseFieldClass}
            />
          </SettingsRow>
          <SettingsRow label="Email" htmlFor="alert_email">
            <input
              id="alert_email"
              type="email"
              value={alertEmail}
              onChange={(e) => setAlertEmail(e.target.value)}
              placeholder="owner@shop.co.ke"
              className={settingsDenseFieldClass}
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

        {flash ? (
          <p
            className={`text-sm [overflow-wrap:anywhere] ${flashIsError ? "text-warn" : "text-ok"}`}
            role={flashIsError ? "alert" : undefined}
          >
            {flash}
          </p>
        ) : null}
      </form>
    </section>
  );
}
