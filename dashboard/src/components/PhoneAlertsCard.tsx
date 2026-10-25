"use client";

import { useCallback, useEffect, useState } from "react";
import { SettingsGroup } from "@/components/settingsUi";
import { Skeleton } from "@/components/ui/Skeleton";
import { Switch } from "@/components/ui/Switch";
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
  "inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg px-3 text-body font-medium text-ink-2 hover:bg-surface-2 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand";

/** One line under "This phone". Short so the Kiswahili copy fits two lines at 360. */
const HINT: Record<"off" | "on" | "error", string> = {
  off: "Missed calls and bookings ping this phone.",
  on: "Missed calls and bookings ping this phone.",
  error: "Couldn't turn on alerts. Try again.",
};

/** States with no switch: why, and the one next step. Texts and WhatsApp keep working. */
const NOTE: Record<"unconfigured" | "unsupported" | "ios-needs-install" | "denied", { title: string; body: string }> = {
  unconfigured: { title: "Not ready yet", body: "We'll switch phone alerts on soon. Texts and WhatsApp still reach you." },
  unsupported: { title: "Not on this browser", body: "Open Scalers in Chrome or Safari to get alerts. Texts and WhatsApp still reach you." },
  "ios-needs-install": { title: "Add to Home Screen first", body: "iPhone shows alerts only from the Scalers icon." },
  denied: { title: "Blocked on this phone", body: "Alerts were blocked for Scalers in this browser." },
};

function Steps({ items }: { items: string[] }) {
  return (
    <ol className="mt-2 space-y-1.5">
      {items.map((item, i) => (
        <li key={item} className="flex items-start gap-2.5 text-meta leading-snug text-ink">
          <span aria-hidden="true" className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-surface text-[0.75rem] font-semibold tabular-nums text-ink-2 ring-1 ring-hairline">
            {i + 1}
          </span>
          <span className="min-w-0 pt-px">{item}</span>
        </li>
      ))}
    </ol>
  );
}

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
      <div data-phone-alerts={state}>
        {state === "loading" ? (
          <div className="flex min-h-14 items-center gap-3 px-4 py-3" role="status" aria-label="Checking this phone">
            <span className="min-w-0 flex-1 space-y-2">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-3 w-48 max-w-full" />
            </span>
            <Skeleton className="h-7 w-12 rounded-full" />
          </div>
        ) : null}

        {state === "off" || state === "on" || state === "error" ? (
          <div className="flex min-h-14 items-center gap-3 px-4 py-2">
            <div className="min-w-0 flex-1">
              <p className="text-body font-medium text-ink">This phone</p>
              <p
                className={state === "error" ? "mt-0.5 text-meta text-attention" : "mt-0.5 text-meta text-ink-2"}
                role={state === "error" ? "alert" : "status"}
                aria-live="polite"
              >
                {busy ? "Asking your phone…" : HINT[state]}
              </p>
            </div>
            <Switch
              checked={state === "on"}
              disabled={busy}
              label="Phone alerts on this phone"
              onCheckedChange={(next) => (next ? onTurnOn?.() : onTurnOff?.())}
            />
          </div>
        ) : null}

        {state === "unconfigured" || state === "unsupported" || state === "ios-needs-install" || state === "denied" ? (
          <div className={state === "denied" ? "m-2 rounded-xl bg-attention-tonal px-3 py-3" : "px-4 py-3"} role="status">
            <p className={state === "denied" ? "text-body font-medium text-attention" : "text-body font-medium text-ink"}>
              {NOTE[state].title}
            </p>
            <p className="mt-0.5 text-meta leading-snug text-ink-2">{NOTE[state].body}</p>
            {state === "denied" ? (
              <Steps items={["Open your browser settings.", "Tap Site settings, then Notifications.", "Allow Scalers, then come back here."]} />
            ) : null}
            {state === "ios-needs-install" ? (
              <Steps items={["Tap Share at the bottom of Safari.", "Tap Add to Home Screen.", "Open Scalers from the icon, then come back here."]} />
            ) : null}
          </div>
        ) : null}
      </div>
      {live && devices.length > 0 ? (
        <ul aria-label="Phones with alerts">
          {devices.map((d) => (
            <li key={d.id} className="flex min-h-14 items-center gap-3 border-t border-hairline py-1.5 ps-4 pe-2">
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-body font-medium text-ink">
                  <span className="min-w-0 break-words">{d.device_label || "Phone"}</span>
                  {d.thisDevice ? (
                    <span className="rounded-full bg-accent-tonal px-2 py-px text-[0.75rem] font-medium text-accent">This phone</span>
                  ) : null}
                </p>
                <p className={d.disabled_at ? "text-meta text-attention" : "text-meta text-ink-2"}>
                  {d.disabled_at ? "Stopped working. Remove it, then turn alerts on again." : `Added ${new Date(d.created_at).toLocaleDateString("en-KE", { day: "numeric", month: "short" })}`}
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
