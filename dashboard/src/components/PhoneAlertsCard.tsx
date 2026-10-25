"use client";

import { useCallback, useEffect, useState } from "react";
import { SettingsGroup } from "@/components/settingsUi";
import { btnPrimary } from "@/components/ui/deskChrome";
import { installPlatform, pushSupport } from "@/lib/pwa";
import {
  VAPID_PUBLIC_KEY,
  currentSubscription,
  isStandalone,
  subscribeThisDevice,
  unsubscribeThisDevice,
} from "@/lib/pushClient";

export type PhoneAlertsState =
  | "loading"
  | "unconfigured"
  | "unsupported"
  | "ios-needs-install"
  | "off"
  | "on"
  | "denied"
  | "error";

export type PhoneAlertDevice = {
  id: string;
  device_label: string | null;
  platform: string | null;
  created_at: string;
  disabled_at: string | null;
  thisDevice?: boolean;
};

const ghostBtn =
  "inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg px-3 text-body font-medium text-ink-2 hover:bg-hairline hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand";

const STATUS: Record<PhoneAlertsState, string> = {
  loading: "Checking this phone…",
  unconfigured: "Phone alerts aren't ready yet. We'll turn them on soon. Texts and WhatsApp still reach you.",
  unsupported: "This browser can't show alerts. Texts and WhatsApp still reach you.",
  "ios-needs-install": "On iPhone, add Scalers to your Home Screen first, then open it from the icon.",
  off: "Get a ping on this phone for missed calls and bookings.",
  on: "On for this phone.",
  denied: "Alerts are blocked for this site.",
  error: "Couldn't turn on alerts. Try again.",
};

/** Pure view so the dev harness can render every state. */
export function PhoneAlertsView({
  state,
  devices,
  busy = false,
  onTurnOn,
  onTurnOff,
  onRemove,
}: {
  state: PhoneAlertsState;
  devices: PhoneAlertDevice[];
  busy?: boolean;
  onTurnOn?: () => void;
  onTurnOff?: () => void;
  onRemove?: (id: string) => void;
}) {
  const live = state === "off" || state === "on" || state === "denied" || state === "error";
  return (
    <SettingsGroup title="Phone alerts">
      <div className="space-y-3 px-4 py-3" data-phone-alerts={state}>
        <p className="text-body text-ink" role="status" aria-live="polite">
          {STATUS[state]}
        </p>
        {state === "denied" ? (
          <p className="text-meta text-ink-2">
            To allow them: open your browser settings, then Site settings, then Notifications, and allow
            Scalers.
          </p>
        ) : null}
        {state === "ios-needs-install" ? (
          <ol className="list-decimal space-y-1 ps-5 text-meta text-ink-2">
            <li>Tap Share at the bottom of Safari.</li>
            <li>Tap Add to Home Screen.</li>
            <li>Open Scalers from the icon and come back here.</li>
          </ol>
        ) : null}
        {state === "off" || state === "error" ? (
          <button type="button" className={btnPrimary} onClick={onTurnOn} disabled={busy}>
            {busy ? "Turning on…" : "Turn on phone alerts"}
          </button>
        ) : null}
        {state === "on" ? (
          <button type="button" className={ghostBtn} onClick={onTurnOff} disabled={busy}>
            Turn off for this phone
          </button>
        ) : null}
      </div>
      {live && devices.length > 0 ? (
        <ul aria-label="Phones with alerts">
          {devices.map((d) => (
            <li key={d.id} className="flex min-h-12 items-center gap-3 border-t border-hairline px-4 py-2">
              <div className="min-w-0 flex-1">
                <p className="truncate text-body font-medium text-ink">
                  {d.device_label || "Phone"}
                  {d.thisDevice ? <span className="font-normal text-ink-2"> · this phone</span> : null}
                </p>
                <p className="text-meta text-ink-2">
                  {d.disabled_at ? "Stopped working" : `Added ${new Date(d.created_at).toLocaleDateString("en-KE", { day: "numeric", month: "short" })}`}
                </p>
              </div>
              <button
                type="button"
                className={ghostBtn}
                onClick={() => onRemove?.(d.id)}
                aria-label={`Remove ${d.device_label || "phone"}`}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </SettingsGroup>
  );
}

type ServerDevice = Omit<PhoneAlertDevice, "thisDevice"> & { endpoint: string };

/** Live card for Settings › How we notify. Asks for permission only when the owner taps. */
export function PhoneAlertsCard() {
  const [state, setState] = useState<PhoneAlertsState>("loading");
  const [devices, setDevices] = useState<PhoneAlertDevice[]>([]);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    if (!VAPID_PUBLIC_KEY) return setState("unconfigured");
    const ua = navigator.userAgent;
    const support = pushSupport({
      platform: installPlatform(ua, isStandalone()),
      ua,
      hasPushManager: "PushManager" in window && "serviceWorker" in navigator,
      hasNotification: "Notification" in window,
    });
    if (support !== "ok") return setState(support);
    const sub = await currentSubscription().catch(() => null);
    const res = await fetch("/api/push/subscribe", { cache: "no-store" }).catch(() => null);
    const list: ServerDevice[] = res && res.ok ? ((await res.json()).devices as ServerDevice[]) : [];
    setDevices(list.map((d) => ({ ...d, thisDevice: Boolean(sub && d.endpoint === sub.endpoint) })));
    if (Notification.permission === "denied") return setState("denied");
    const mine = sub && list.some((d) => d.endpoint === sub.endpoint && !d.disabled_at);
    setState(Notification.permission === "granted" && mine ? "on" : "off");
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function turnOn() {
    setBusy(true);
    const out = await subscribeThisDevice().catch(() => "error" as const);
    setBusy(false);
    if (out === "denied") return setState("denied");
    if (out !== "granted") return setState("error");
    await refresh();
  }

  async function turnOff() {
    setBusy(true);
    await unsubscribeThisDevice();
    setBusy(false);
    await refresh();
  }

  async function remove(id: string) {
    const d = devices.find((x) => x.id === id);
    if (d?.thisDevice) return turnOff();
    await fetch("/api/push/subscribe", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    }).catch(() => null);
    await refresh();
  }

  return (
    <PhoneAlertsView
      state={state}
      devices={devices}
      busy={busy}
      onTurnOn={turnOn}
      onTurnOff={turnOff}
      onRemove={remove}
    />
  );
}
