export type HandoffMode = "callback" | "live_transfer";

export const HANDOFF_OPTIONS: {
  id: HandoffMode;
  label: string;
  blurb: string;
}[] = [
  {
    id: "callback",
    label: "WhatsApp / email callback",
    blurb:
      "Notify you or a teammate. The AI stays on the line and takes a clear message.",
  },
  {
    id: "live_transfer",
    label: "Live transfer (when available)",
    blurb:
      "Prefer connecting the caller to a human. Falls back to callback if transfer is not ready.",
  },
];

export function parseHandoffMode(raw: unknown): HandoffMode {
  const v = String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  if (v === "live_transfer" || v === "livetransfer" || v === "transfer") {
    return "live_transfer";
  }
  return "callback";
}
