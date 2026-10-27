import ALERT_TYPE_FIXTURE from "./alertTypeDefaults.json" with { type: "json" };

/**
 * Owner notify channel preferences + platform availability for Desk Settings.
 * Voice honors the same prefs via tenants.notify_channels.
 */

export type NotifyChannelId = "sms" | "whatsapp" | "email";

export type AlertTypeId = "missed_call" | "booking" | "other_calls";
export type AlertChannelId = "push" | "sms" | "whatsapp" | "email";
export type AlertTypeCells = Record<AlertChannelId, boolean>;
/** Sparse: only cells that differ from ALERT_TYPE_DEFAULTS are stored. */
export type AlertTypeChoices = Partial<Record<AlertTypeId, Partial<AlertTypeCells>>>;

export type NotifyChannels = Record<NotifyChannelId, boolean> & {
  caller_sms: boolean;
  missed_textback: boolean;
  /** Master phone-alert switch; absent = on. */
  push?: boolean;
  by_type?: AlertTypeChoices;
};

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
  caller_sms: false,
  missed_textback: false,
};

/**
 * Private-beta platform availability.
 * WhatsApp staff alerts are live on the Scalers platform sender (utility templates).
 * Override with NEXT_PUBLIC_NOTIFY_*_AVAILABLE if a host must hide a channel.
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
      available: envFlag("NEXT_PUBLIC_NOTIFY_WHATSAPP_AVAILABLE", true),
      unavailableLabel: "WhatsApp alerts not enabled on this workspace yet",
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
      description: "WhatsApp to the alert phone and People numbers with Inbox, Escalate, or Ops",
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
  if (typeof obj.caller_sms === "boolean") next.caller_sms = obj.caller_sms;
  if (typeof obj.missed_textback === "boolean") next.missed_textback = obj.missed_textback;
  if (typeof obj.push === "boolean") next.push = obj.push;
  const byType = sparseAlertChoices(parseAlertTypes(obj));
  if (Object.keys(byType).length) next.by_type = byType;

  // Force unavailable platform channels off in the saved preference view.
  const avail = platformNotifyAvailability();
  for (const id of Object.keys(avail) as NotifyChannelId[]) {
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

/* ---------- Per-alert-type choices (How we notify › What alerts you get) ---------- */

export const ALERT_TYPES = ALERT_TYPE_FIXTURE.types as AlertTypeId[];
export const ALERT_CHANNELS = ALERT_TYPE_FIXTURE.channels as AlertChannelId[];
export const ALERT_TYPE_DEFAULTS = ALERT_TYPE_FIXTURE.defaults as Record<AlertTypeId, AlertTypeCells>;
const MISSED_GUARD_ORDER = ALERT_TYPE_FIXTURE.missedCallGuardOrder as AlertChannelId[];

export const ALERT_TYPE_META: { id: AlertTypeId; label: string; what: string }[] = [
  { id: "missed_call", label: "Missed calls", what: "A caller didn't get through." },
  { id: "booking", label: "Bookings", what: "Booked, moved or cancelled." },
  { id: "other_calls", label: "Other calls", what: "The assistant answered: a question or a call-back request." },
];

export const ALERT_CHANNEL_LABEL: Record<AlertChannelId, string> = {
  push: "This phone",
  sms: "SMS",
  whatsapp: "WhatsApp",
  email: "Email",
};

const LEGACY_KEYS: Record<string, string> = (ALERT_TYPE_FIXTURE as { legacyKeys?: Record<string, string> }).legacyKeys || {};

/** Stored row for a type; old keys (message, lead) map to other_calls. */
function storedRow(stored: Record<string, unknown>, type: AlertTypeId): Record<string, unknown> {
  const isRow = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === "object" && !Array.isArray(v);
  if (isRow(stored[type])) return stored[type];
  for (const [old, now] of Object.entries(LEGACY_KEYS)) {
    if (now === type && isRow(stored[old])) return stored[old];
  }
  return {};
}

/** Full grid: stored cells win, missing cells take the defaults. */
export function parseAlertTypes(raw: unknown): Record<AlertTypeId, AlertTypeCells> {
  const obj = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const stored =
    obj.by_type && typeof obj.by_type === "object" && !Array.isArray(obj.by_type)
      ? (obj.by_type as Record<string, unknown>)
      : {};
  const out = {} as Record<AlertTypeId, AlertTypeCells>;
  for (const type of ALERT_TYPES) {
    const row = storedRow(stored, type);
    const cells = {} as AlertTypeCells;
    for (const ch of ALERT_CHANNELS) {
      cells[ch] = typeof row[ch] === "boolean" ? (row[ch] as boolean) : ALERT_TYPE_DEFAULTS[type][ch];
    }
    out[type] = cells;
  }
  return out;
}

/** Only the cells the owner changed from the defaults (changed-only save). */
export function sparseAlertChoices(full: Record<AlertTypeId, AlertTypeCells>): AlertTypeChoices {
  const out: AlertTypeChoices = {};
  for (const type of ALERT_TYPES) {
    for (const ch of ALERT_CHANNELS) {
      if (full[type][ch] !== ALERT_TYPE_DEFAULTS[type][ch]) {
        out[type] = { ...(out[type] || {}), [ch]: full[type][ch] };
      }
    }
  }
  return out;
}

/** Master switch for a column (SMS/WhatsApp/Email from the channel picker; push absent = on). */
export function alertMasterOn(channels: NotifyChannels, ch: AlertChannelId): boolean {
  if (ch === "push") return channels.push !== false;
  return Boolean(channels[ch]);
}

/** Cells that will actually send for a type (master AND cell). */
export function effectiveAlertCells(channels: NotifyChannels, type: AlertTypeId): AlertTypeCells {
  const cells = parseAlertTypes(channels)[type];
  const out = {} as AlertTypeCells;
  for (const ch of ALERT_CHANNELS) out[ch] = alertMasterOn(channels, ch) && cells[ch];
  if (type === "missed_call" && !ALERT_CHANNELS.some((ch) => out[ch])) {
    const pick = MISSED_GUARD_ORDER.find((ch) => alertMasterOn(channels, ch)) || "sms";
    out[pick] = true;
  }
  return out;
}

/**
 * Toggle one cell. Returns null when blocked: missed calls must keep one
 * channel that will actually send.
 */
export function toggleAlertCell(
  channels: NotifyChannels,
  type: AlertTypeId,
  ch: AlertChannelId
): NotifyChannels | null {
  const full = parseAlertTypes(channels);
  const nextOn = !full[type][ch];
  if (type === "missed_call" && !nextOn) {
    const remaining = ALERT_CHANNELS.filter((c) => c !== ch && full[type][c] && alertMasterOn(channels, c));
    if (remaining.length === 0) return null;
  }
  full[type] = { ...full[type], [ch]: nextOn };
  const by_type = sparseAlertChoices(full);
  const next: NotifyChannels = { ...channels };
  if (Object.keys(by_type).length) next.by_type = by_type;
  else delete next.by_type;
  return next;
}

export function resetAlertChoices(channels: NotifyChannels): NotifyChannels {
  const next: NotifyChannels = { ...channels };
  delete next.by_type;
  return next;
}
