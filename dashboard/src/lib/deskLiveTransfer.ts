import type { HandoffMode } from "@/lib/handoffMode";

export function deskLiveTransferExecutorEnabled(
  raw: unknown = process.env.VOICE_LIVE_TRANSFER
): boolean {
  return /^(1|true|on|yes)$/i.test(String(raw || "").trim());
}

export function handoffComingSoonLine(name?: string | null): string {
  const who = String(name || "").trim();
  return who
    ? `Coming soon. Today we message ${who}.`
    : "Coming soon. Today we message a teammate.";
}

export function liveConnectReasonLabel(reason: string): string {
  switch (String(reason || "").trim()) {
    case "executor_off":
      return "Live connect is off.";
    case "handoff_callback":
      return "Handoff is message teammate.";
    case "closed_or_unknown":
      return "Outside open hours.";
    case "no_destination":
      return "No team phone.";
    case "escalate_off":
      return "Escalate is off.";
    default: {
      const clean = String(reason || "").trim().replace(/_/g, " ");
      return clean;
    }
  }
}

export function liveConnectUnavailableLine(reason?: string | null): string {
  const key = String(reason || "").trim();
  if (!key || key === "ok" || key === "unavailable") {
    return "Notify only (live connect unavailable)";
  }
  return `Notify only (live connect unavailable). ${liveConnectReasonLabel(key)}`;
}

export function formatLiveConnectStamp(
  meta: Record<string, unknown>,
  handoffMode: HandoffMode
): string | null {
  if (handoffMode !== "live_transfer") return null;
  const raw = meta.live_connect;
  if (raw && typeof raw === "object") {
    const row = raw as { ran?: unknown; reason?: unknown };
    if (row.ran === true) return null;
    return liveConnectUnavailableLine(
      typeof row.reason === "string" ? row.reason : null
    );
  }
  return liveConnectUnavailableLine("unavailable");
}
