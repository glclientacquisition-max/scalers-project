export type AfterHoursMode = "serve" | "message";

export const AFTER_HOURS_OPTIONS: {
  id: AfterHoursMode;
  label: string;
  blurb: string;
}[] = [
  {
    id: "serve",
    label: "Keep helping",
    blurb: "Answer and capture leads when closed.",
  },
  {
    id: "message",
    label: "Message only",
    blurb: "Note the request for a callback.",
  },
];

export function parseAfterHoursMode(raw: unknown): AfterHoursMode {
  const v = String(raw || "")
    .trim()
    .toLowerCase();
  return v === "message" ? "message" : "serve";
}
