"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { TenantRow } from "@/lib/supabase";
import { NotifyChannelPicker } from "@/components/NotifyChannelPicker";
import {
  settingsDenseFieldClass,
  settingsPanelHeadingClass,
  settingsPrimaryButtonClass,
  ToolSwitch,
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

export function AlertsPanel({ tenant }: { tenant: TenantRow }) {
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
    <section className="min-w-0 space-y-4">
      <h2 className={settingsPanelHeadingClass}>Alerts</h2>

      <form action={formAction} className="min-w-0 space-y-3">
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

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="block text-xs font-medium text-ink-soft" htmlFor="owner">
              Alert phone
            </label>
            <input
              id="owner"
              value={ownerWhatsapp}
              onChange={(e) => setOwnerWhatsapp(e.target.value)}
              placeholder="+254 700 000 000"
              className={`${settingsDenseFieldClass} mt-1`}
            />
          </div>
          <div>
            <label
              className="block text-xs font-medium text-ink-soft"
              htmlFor="alert_email"
            >
              Email
            </label>
            <input
              id="alert_email"
              type="email"
              value={alertEmail}
              onChange={(e) => setAlertEmail(e.target.value)}
              placeholder="owner@shop.co.ke"
              className={`${settingsDenseFieldClass} mt-1`}
            />
          </div>
        </div>

        <NotifyChannelPicker
          value={notifyChannels}
          onChange={setNotifyChannels}
          heading={null}
        />

        <div className="flex min-h-11 items-center justify-between gap-3 rounded-xl border border-line bg-surface px-3 py-3">
          <p className="text-sm font-medium text-ink">Text customers</p>
          <ToolSwitch
            checked={Boolean(notifyChannels.caller_sms)}
            onChange={(next) =>
              setNotifyChannels({ ...notifyChannels, caller_sms: next })
            }
            label="Text customers"
          />
        </div>
        <div className="flex min-h-11 items-center justify-between gap-3 rounded-xl border border-line bg-surface px-3 py-3">
          <p className="text-sm font-medium text-ink">Text back missed calls</p>
          <ToolSwitch
            checked={Boolean(notifyChannels.missed_textback)}
            onChange={(next) =>
              setNotifyChannels({ ...notifyChannels, missed_textback: next })
            }
            label="Text back missed calls"
          />
        </div>

        <button
          type="submit"
          disabled={pending}
          className={settingsPrimaryButtonClass}
        >
          {pending ? "Saving…" : "Save"}
        </button>
      </form>

      {flash ? (
        <p
          className={`text-sm [overflow-wrap:anywhere] ${flashIsError ? "text-warn" : "text-ok"}`}
          role={flashIsError ? "alert" : undefined}
        >
          {flash}
        </p>
      ) : null}
    </section>
  );
}
