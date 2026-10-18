import { formatCallWhen } from "@/lib/callsTriage";

export type EscalationDeliveryState = "sent" | "failed" | "none";

export type EscalationDelivery = {
  state: EscalationDeliveryState;
  line: string | null;
};

type NotifyChannel = {
  channel?: string | null;
  to?: string | null;
  role?: string | null;
};

function channelLabel(raw: string): string {
  const key = raw.toLowerCase();
  if (key === "sms") return "SMS";
  if (key === "whatsapp") return "WhatsApp";
  if (key === "email") return "Email";
  return raw;
}

/** Kenyan numbers stored as 2547… read as +2547… on screen. */
export function displayPhone(raw: string): string {
  const text = String(raw || "").trim();
  if (/^254\d{9}$/.test(text)) return `+${text}`;
  return text;
}

/** A send this long after the call ended came from the Desk (Alert teammate), not from the call. */
export const DESK_ALERT_AFTER_MS = 10 * 60 * 1000;

function liveChannels(raw: unknown): NotifyChannel[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((row): row is NotifyChannel => {
    if (!row || typeof row !== "object") return false;
    const channel = String((row as NotifyChannel).channel || "").trim();
    return Boolean(channel) && channel !== "desk_note";
  });
}

function hasEscalationTarget(meta: Record<string, unknown>): boolean {
  const raw = meta.escalated_to;
  if (!raw || typeof raw !== "object") return false;
  const row = raw as { name?: unknown; role?: unknown; phone?: unknown };
  return Boolean(
    String(row.name || "").trim() ||
      String(row.role || "").trim() ||
      String(row.phone || "").trim()
  );
}

/** Desk line from `calls.summary.escalation_notify`. Never "Escalation sent" without a live channel. */
export function formatEscalationDelivery(
  meta: Record<string, unknown>,
  opts: { callEndedAt?: string | null; fromDesk?: boolean } = {}
): EscalationDelivery {
  const notify = meta.escalation_notify;
  if (notify && typeof notify === "object") {
    const row = notify as {
      ok?: unknown;
      soft?: unknown;
      stage?: unknown;
      channels?: unknown;
      at?: unknown;
    };
    const channels = liveChannels(row.channels);
    const stage = String(row.stage || "");
    const reason = String((row as { reason?: unknown }).reason || "").trim();
    if (reason === "instance_already_sent") {
      return { state: "sent", line: "Already pinged this ticket." };
    }
    if (reason === "whatsapp_billing" || /131042/.test(reason)) {
      return { state: "failed", line: "WhatsApp billing is not set." };
    }
    if (row.ok === true && row.soft !== true && stage === "notified" && channels.length) {
      const bits = channels.map((item) => {
        const label = channelLabel(String(item.channel));
        const to = displayPhone(String(item.to || ""));
        return to ? `${label} to ${to}` : label;
      });
      const at = typeof row.at === "string" && row.at ? formatCallWhen(row.at) : "";
      const atMs = typeof row.at === "string" ? Date.parse(row.at) : Number.NaN;
      const endMs = opts.callEndedAt ? Date.parse(opts.callEndedAt) : Number.NaN;
      const fromDesk =
        opts.fromDesk === true ||
        (Number.isFinite(atMs) && Number.isFinite(endMs) && atMs - endMs > DESK_ALERT_AFTER_MS);
      if (fromDesk) {
        // A teammate alert sent from the Desk after the call, not an SMS from the call itself.
        const target = meta.escalated_to && typeof meta.escalated_to === "object"
          ? String((meta.escalated_to as { name?: unknown }).name || "").trim()
          : "";
        const who = target || "a teammate";
        return { state: "sent", line: at ? `Alerted ${who} from Desk · ${at}` : `Alerted ${who} from Desk` };
      }
      return {
        state: "sent",
        line: at ? `${bits.join(". ")}. ${at}` : bits.join(". "),
      };
    }
    if (
      row.ok === false ||
      row.soft === true ||
      stage === "failed" ||
      stage === "desk_only" ||
      hasEscalationTarget(meta)
    ) {
      return { state: "failed", line: "Notification retry pending" };
    }
  }

  if (hasEscalationTarget(meta)) {
    return { state: "failed", line: "Notification retry pending" };
  }
  return { state: "none", line: null };
}
