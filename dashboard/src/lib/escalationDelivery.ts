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
  meta: Record<string, unknown>
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
    if (row.ok === true && row.soft !== true && stage === "notified" && channels.length) {
      const bits = channels.map((item) => {
        const label = channelLabel(String(item.channel));
        const to = String(item.to || "").trim();
        return to ? `${label} to ${to}` : label;
      });
      const at = typeof row.at === "string" && row.at ? formatCallWhen(row.at) : "";
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
      return { state: "failed", line: "Needs human. Notify failed." };
    }
  }

  if (hasEscalationTarget(meta)) {
    return { state: "failed", line: "Needs human. Notify failed." };
  }
  return { state: "none", line: null };
}
