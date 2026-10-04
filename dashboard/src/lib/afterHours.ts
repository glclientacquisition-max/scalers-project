export type AfterHoursMode = "serve" | "message";

export const AFTER_HOURS_OPTIONS: {
  id: AfterHoursMode;
  label: string;
  blurb: string;
}[] = [
  {
    id: "message",
    label: "Message only",
    blurb: "Take a name and a message.",
  },
  {
    id: "serve",
    label: "Full assistant",
    blurb: "Answer, book, and change a visit.",
  },
];

export function parseAfterHoursMode(raw: unknown): AfterHoursMode {
  const v = String(raw || "")
    .trim()
    .toLowerCase();
  return v === "message" ? "message" : "serve";
}
