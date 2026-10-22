/**
 * Settings hub (ADMIN_V2). Pure: no imports with values, so tests load it in node.
 * Read-only (edits wait for step-up). Values come from billing_lifecycle_settings; when a column is
 * not on this environment the row says so instead of inventing a value.
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
  hold_winback_enabled?: boolean | null;
  number_hold_days?: number | null;
  reactivation_fee_kes?: number | null;
  /** False when the hold columns are not on this environment (e.g. prod before #885). */
  holdColumns?: boolean;
};

export type HubValue = { label: string; value: string; note: string; state: "set" | "missing" | "absent" };

export const NOT_HERE = "Not on this environment";

export function daysLabel(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "Not set";
  return `${n} ${n === 1 ? "day" : "days"}`;
}

export function onOff(v: boolean | null | undefined): string {
  return v == null ? "Not set" : v ? "On" : "Off";
}

/** Hold switch, number hold, reactivation fee (#885), plus the voicemail window. */
export function holdSettings(raw: SettingsHubRaw | null): HubValue[] {
  const here = !!raw && raw.holdColumns !== false;
  const absent = (label: string, note: string): HubValue => ({ label, value: NOT_HERE, note, state: "absent" });
  const fee = raw?.reactivation_fee_kes;
  return [
    here
      ? { label: "Hold switch", value: onOff(raw!.hold_winback_enabled), note: "Keep a stopped business's number so it can come back.", state: raw!.hold_winback_enabled == null ? "missing" : "set" }
      : absent("Hold switch", "Keep a stopped business's number so it can come back."),
    here
      ? { label: "Number hold", value: daysLabel(raw!.number_hold_days), note: "Days a stopped business's number is kept before it is released.", state: raw!.number_hold_days == null ? "missing" : "set" }
      : absent("Number hold", "Days a stopped business's number is kept before it is released."),
    here
      ? { label: "Reactivation fee", value: fee == null ? "Not set" : `KSh ${fee.toLocaleString("en-KE")}`, note: "Charged when a held business comes back.", state: "set" }
      : absent("Reactivation fee", "Charged when a held business comes back."),
    {
      label: "Voicemail window",
      value: daysLabel(raw?.voicemail_hold_days ?? null),
      note: "Days callers can still leave a voicemail after a trial ends or a line is suspended.",
      state: raw?.voicemail_hold_days == null ? "missing" : "set",
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
