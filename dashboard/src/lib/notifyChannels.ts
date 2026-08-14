/**
 * Owner notify channel preferences + platform availability for Desk Settings.
 * Voice honors the same prefs via tenants.notify_channels.
 */

export type NotifyChannelId = "sms" | "whatsapp" | "email";

export type NotifyChannels = Record<NotifyChannelId, boolean>;

export type NotifyChannelMeta = {
  id: NotifyChannelId;
  label: string;
  description: string;
  /** Platform can deliver this channel today. */
  available: boolean;
  /** Shown when available=false (greyed card). */
  unavailableLabel: string;
};

export const DEFAULT_NOTIFY_CHANNELS: NotifyChannels = {
  sms: true,
  whatsapp: true,
  email: true,
};

/**
 * Private-beta platform availability.
 * WhatsApp automated alerts are not live yet — show logo but grey + disable toggle.
 * Override later with NEXT_PUBLIC_NOTIFY_*_AVAILABLE if needed.
 */
export function platformNotifyAvailability(): Record<
  NotifyChannelId,
  { available: boolean; unavailableLabel: string }
> {
  const envFlag = (name: string, fallback: boolean) => {
    const raw = String(process.env[name] || "").trim().toLowerCase();
    if (raw === "1" || raw === "true" || raw === "yes") return true;
    if (raw === "0" || raw === "false" || raw === "no") return false;
    return fallback;
  };

  return {
    sms: {
      available: envFlag("NEXT_PUBLIC_NOTIFY_SMS_AVAILABLE", true),
      unavailableLabel: "SMS alerts not enabled on this workspace yet",
    },
    whatsapp: {
      available: envFlag("NEXT_PUBLIC_NOTIFY_WHATSAPP_AVAILABLE", false),
      unavailableLabel: "Coming soon — WhatsApp alerts are being wired",
    },
    email: {
      available: envFlag("NEXT_PUBLIC_NOTIFY_EMAIL_AVAILABLE", true),
      unavailableLabel: "Email alerts not enabled on this workspace yet",
    },
  };
}

export const NOTIFY_CHANNEL_META: NotifyChannelMeta[] = (() => {
  const avail = platformNotifyAvailability();
  return [
    {
      id: "sms",
      label: "SMS",
      description: "Text the owner / teammate on escalate and saved leads",
      available: avail.sms.available,
      unavailableLabel: avail.sms.unavailableLabel,
    },
    {
      id: "whatsapp",
      label: "WhatsApp",
      description: "WhatsApp alert to the owner notification number",
      available: avail.whatsapp.available,
      unavailableLabel: avail.whatsapp.unavailableLabel,
    },
    {
      id: "email",
      label: "Email",
      description: "Send to the alert email when phone channels miss",
      available: avail.email.available,
      unavailableLabel: avail.email.unavailableLabel,
    },
  ];
})();

export function parseNotifyChannels(raw: unknown): NotifyChannels {
  const next: NotifyChannels = { ...DEFAULT_NOTIFY_CHANNELS };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return next;
  const obj = raw as Record<string, unknown>;
  if (typeof obj.sms === "boolean") next.sms = obj.sms;
  if (typeof obj.whatsapp === "boolean") next.whatsapp = obj.whatsapp;
  if (typeof obj.email === "boolean") next.email = obj.email;

  // Force unavailable platform channels off in the saved preference view.
  const avail = platformNotifyAvailability();
  for (const id of Object.keys(next) as NotifyChannelId[]) {
    if (!avail[id].available) next[id] = false;
  }

  if (!next.sms && !next.whatsapp && !next.email) {
    if (avail.sms.available) next.sms = true;
    else if (avail.email.available) next.email = true;
  }
  return next;
}

export function parseNotifyChannelsField(raw: FormDataEntryValue | null): NotifyChannels {
  if (typeof raw !== "string" || !raw.trim()) {
    return parseNotifyChannels(null);
  }
  try {
    return parseNotifyChannels(JSON.parse(raw));
  } catch {
    return parseNotifyChannels(null);
  }
}
