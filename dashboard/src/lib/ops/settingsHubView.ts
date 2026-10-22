/**
 * Settings hub (ADMIN_V2). Pure: no imports with values, so tests load it in node.
 * Read-only today. The hold switch and reactivation fee have no stored setting yet, so they say so
 * instead of inventing a value.
 */
export type SettingsHubRaw = {
  voicemail_hold_days?: number | null;
  shadow_invoices?: boolean | null;
  billing_notices_send?: boolean | null;
  desk_plan_change_enabled?: boolean | null;
  new_signup_trial_enabled?: boolean | null;
  package_editor_enabled?: boolean | null;
  price_change_approval_threshold_kes?: number | null;
  updated_at?: string | null;
};

export type HubValue = { label: string; value: string; note: string; state: "set" | "placeholder" | "missing" };

export const NUMBER_REUSE_HOLD_DAYS = 30;

export function daysLabel(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "Not set";
  return `${n} ${n === 1 ? "day" : "days"}`;
}

export function onOff(v: boolean | null | undefined): string {
  return v == null ? "Not set" : v ? "On" : "Off";
}

/** Hold switch, hold length, reactivation fee: the three settings this hub owns. */
export function holdSettings(raw: SettingsHubRaw | null): HubValue[] {
  return [
    {
      label: "Hold switch",
      value: "Always on",
      note: "Suspended lines always hold for voicemail. No switch is stored yet.",
      state: "missing",
    },
    {
      label: "Hold length",
      value: daysLabel(raw?.voicemail_hold_days ?? null),
      note: "Days callers can still leave a voicemail after a trial ends or a line is suspended. 1 to 90.",
      state: raw?.voicemail_hold_days == null ? "missing" : "set",
    },
    {
      label: "Number reuse hold",
      value: daysLabel(NUMBER_REUSE_HOLD_DAYS),
      note: "A released number waits this long before another business gets it. Placeholder, not decided.",
      state: "placeholder",
    },
    {
      label: "Reactivation fee",
      value: "Not set",
      note: "No fee is stored or charged when a suspended business comes back.",
      state: "missing",
    },
  ];
}

export function billingSwitches(raw: SettingsHubRaw | null): HubValue[] {
  const kes = raw?.price_change_approval_threshold_kes;
  const sw = (label: string, v: boolean | null | undefined, note: string): HubValue => ({ label, value: onOff(v), note, state: v == null ? "missing" : "set" });
  return [
    sw("Shadow invoices", raw?.shadow_invoices, "Invoices are drafted but not sent."),
    sw("Billing notices", raw?.billing_notices_send, "Owners get billing messages."),
    sw("Trial for new sign-ups", raw?.new_signup_trial_enabled, "New businesses start on a trial."),
    sw("Owners change plan", raw?.desk_plan_change_enabled, "Owners can switch plan from the desk."),
    sw("Package editor", raw?.package_editor_enabled, "Package prices can be edited here."),
    {
      label: "Price change approval",
      value: kes == null ? "Not set" : `Over KSh ${kes.toLocaleString("en-KE")}`,
      note: "Price changes above this need a second approval.",
      state: kes == null ? "missing" : "set",
    },
  ];
}
