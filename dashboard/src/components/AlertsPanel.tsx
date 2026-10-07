"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { TenantRow } from "@/lib/supabase";
import { NotifyChannelPicker } from "@/components/NotifyChannelPicker";
import {
  SettingsGroup,
  SettingsPageHeader,
  SettingsRow,
  ToolSwitch,
  settingsValueFieldClass,
  settingsFormBodyClass,
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
import { pendingSpinnerClass } from "@/components/ui/deskChrome";
import { notify } from "@/components/ui/DeskNotice";
import { useSettingsLeaveSource } from "@/components/SettingsLeaveGuard";
import { CaptureConfirmList } from "@/components/CaptureConfirmList";
import { confirmCaptureFields } from "@/app/(desk)/settings/provenanceActions";
import { alertsConfirmRows, type DeskFieldMetaClient } from "@/lib/fieldMetaAttestUi";

const initial: AlertsActionState = {};

export const ALERTS_SETTINGS_FORM_ID = "alerts-settings-form";

export function AlertsPanel({
  tenant,
  businessName,
  fieldMeta = null,
}: {
  tenant: TenantRow;
  businessName: string;
  fieldMeta?: DeskFieldMetaClient;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [ownerWhatsapp, setOwnerWhatsapp] = useState(
    tenant.whatsapp_notification_number || ""
  );
  const [alertEmail, setAlertEmail] = useState(tenant.alert_email || "");
  const [notifyChannels, setNotifyChannels] = useState<NotifyChannels>(() =>
    parseNotifyChannels(tenant.notify_channels)
  );
  const [state, formAction, pending] = useActionState(saveAlertsAction, initial);
  const alertsDraft = [
    ownerWhatsapp,
    alertEmail,
    JSON.stringify(notifyChannels),
  ].join("\u0001");
  const [alertsBaseline, setAlertsBaseline] = useState(alertsDraft);
  const alertsDirty = alertsDraft !== alertsBaseline;
  const savedAlertsRef = useRef(state);
  useSettingsLeaveSource("alerts", alertsDirty);

  useEffect(() => {
    const phone = tenant.whatsapp_notification_number || "";
    const email = tenant.alert_email || "";
    const channels = parseNotifyChannels(tenant.notify_channels);
    setOwnerWhatsapp(phone);
    setAlertEmail(email);
    setNotifyChannels(channels);
    setAlertsBaseline([phone, email, JSON.stringify(channels)].join("\u0001"));
  }, [
    tenant.whatsapp_notification_number,
    tenant.alert_email,
    tenant.notify_channels,
  ]);

  useEffect(() => {
    if (!state.ok || savedAlertsRef.current === state) return;
    savedAlertsRef.current = state;
    setAlertsBaseline(alertsDraft);
    notify(state.message || "Saved");
    router.refresh();
  }, [state, alertsDraft, router]);

  const alertReviewRows = alertsConfirmRows(fieldMeta, ownerWhatsapp, alertEmail);

  async function confirmAlertPaths(paths: string[]) {
    const unique = [...new Set(paths.map((path) => path.trim()).filter(Boolean))];
    if (!unique.length) return;
    setConfirming(true);
    try {
      const result = await confirmCaptureFields(unique);
      if (result.ok) router.refresh();
    } finally {
      setConfirming(false);
    }
  }

  return (
    <section className="min-w-0 w-full space-y-6">
      <SettingsPageHeader
        businessName={businessName}
        lineLive={false}
        showBack
        title="How we notify"
        alert={state.error}
        action={
          <button
            type="submit"
            form={ALERTS_SETTINGS_FORM_ID}
            disabled={pending}
            className={`${settingsPrimaryButtonClass} gap-2`}
          >
            {pending ? (
              <>
                <span aria-hidden="true" className={pendingSpinnerClass} />
                Saving
              </>
            ) : (
              "Save"
            )}
          </button>
        }
      />
      <form
        id={ALERTS_SETTINGS_FORM_ID}
        action={formAction}
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

        <CaptureConfirmList
          pending={confirming}
          onConfirm={(path) => void confirmAlertPaths([path])}
          onConfirmAll={(paths) => void confirmAlertPaths(paths)}
          rows={alertReviewRows}
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
    </section>
  );
}
