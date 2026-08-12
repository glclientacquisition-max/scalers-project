export type AgentTools = {
  /** Notify a teammate / owner for anger, refunds, or role asks. */
  escalate: boolean;
  /** Allow the receptionist to hang up after goodbye. */
  end_call: boolean;
};

export const DEFAULT_AGENT_TOOLS: AgentTools = {
  escalate: true,
  end_call: true,
};

export const AGENT_TOOL_OPTIONS: {
  id: keyof AgentTools;
  label: string;
  blurb: string;
  onLabel: string;
  offLabel: string;
}[] = [
  {
    id: "escalate",
    label: "Alert a teammate",
    blurb: "Notify for anger, refunds, or role requests.",
    onLabel: "On: send alerts",
    offLabel: "Off: take a note",
  },
  {
    id: "end_call",
    label: "Hang up after goodbye",
    blurb: "End the call after a clear goodbye.",
    onLabel: "On: can hang up",
    offLabel: "Off: stay on the line",
  },
];

export function parseAgentTools(raw: unknown): AgentTools {
  const base = { ...DEFAULT_AGENT_TOOLS };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return base;
  const obj = raw as Record<string, unknown>;
  if (typeof obj.escalate === "boolean") base.escalate = obj.escalate;
  if (typeof obj.end_call === "boolean") base.end_call = obj.end_call;
  // Accept camelCase from older drafts
  if (typeof obj.endCall === "boolean") base.end_call = obj.endCall;
  return base;
}
