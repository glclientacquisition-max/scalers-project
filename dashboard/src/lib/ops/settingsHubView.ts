/**
 * Settings hub (ADMIN_V2). Pure: no value imports so tests load it in node.
 * One Number-hold card: three definition rows. Read-only until step-up.
 * When hold columns are not on this environment the rows say so — never invent values.
 */
export type SettingsHubRaw = {
  voicemail_hold_days?: number | null;
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

/** The three Number-hold rows (#885). Labels match the card. */
export function holdSettings(raw: SettingsHubRaw | null): HubValue[] {
  const here = !!raw && raw.holdColumns !== false;
  const absent = (label: string, note: string): HubValue => ({ label, value: NOT_HERE, note, state: "absent" });
  const fee = raw?.reactivation_fee_kes;
  return [
    here
      ? {
          label: "Hold after release",
          value: onOff(raw!.hold_winback_enabled),
          note: "Keep a stopped business's number so it can come back.",
          state: raw!.hold_winback_enabled == null ? "missing" : "set",
        }
      : absent("Hold after release", "Keep a stopped business's number so it can come back."),
    here
      ? {
          label: "Hold length",
          value: daysLabel(raw!.number_hold_days),
          note: "Days the number is kept before it is released.",
          state: raw!.number_hold_days == null ? "missing" : "set",
        }
      : absent("Hold length", "Days the number is kept before it is released."),
    here
      ? {
          label: "Reactivation fee",
          value: fee == null ? "Not set" : `KSh ${fee.toLocaleString("en-KE")}`,
          note: "Charged when a held business comes back.",
          state: "set",
        }
      : absent("Reactivation fee", "Charged when a held business comes back."),
  ];
}
