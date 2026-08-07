export type AfterHoursMode = "serve" | "message";

export const AFTER_HOURS_OPTIONS: {
  id: AfterHoursMode;
  label: string;
  blurb: string;
}[] = [
  {
    id: "serve",
    label: "Keep helping after hours",
    blurb:
      "Still answer questions and capture the lead. Be clear you are closed for walk-in or same-day service.",
  },
  {
    id: "message",
    label: "Take a message only",
    blurb:
      "Say you are closed, note name and request, and promise a callback when the team is open.",
  },
];

export function parseAfterHoursMode(raw: unknown): AfterHoursMode {
  const v = String(raw || "")
    .trim()
    .toLowerCase();
  return v === "message" ? "message" : "serve";
}
