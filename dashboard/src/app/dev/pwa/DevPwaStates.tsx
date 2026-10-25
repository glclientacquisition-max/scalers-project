"use client";

import { InstallCardView } from "@/components/InstallCard";
import { PhoneAlertsView, type PhoneAlertDevice, type PhoneAlertsState } from "@/components/PhoneAlertsCard";
import { deskListTitleClass } from "@/components/ui/deskChrome";

const DEVICES: PhoneAlertDevice[] = [
  { id: "d1", device_label: "Android phone", platform: "installed", created_at: "2026-10-25T07:10:00Z", disabled_at: null, thisDevice: true },
  { id: "d2", device_label: "iPhone", platform: "installed", created_at: "2026-10-22T09:00:00Z", disabled_at: null },
];

export function DevPwaStates({ view }: { view: string }) {
  if (view === "install-android" || view === "install-ios") {
    return (
      <div className="min-h-dvh bg-canvas p-4">
        <h1 className={deskListTitleClass}>Inbox</h1>
        <p className="mt-2 text-body text-ink-2">Sample page behind the install card.</p>
        <InstallCardView platform={view === "install-ios" ? "ios" : "android"} />
      </div>
    );
  }
  const state = (view.replace(/^alerts-/, "") || "off") as PhoneAlertsState;
  const devices = state === "on" ? DEVICES : state === "denied" ? DEVICES.slice(1) : [];
  return (
    <div className="min-h-dvh bg-canvas p-4">
      <h1 className={deskListTitleClass}>How we notify</h1>
      <div className="mt-4">
        <PhoneAlertsView state={state} devices={devices} />
      </div>
    </div>
  );
}
