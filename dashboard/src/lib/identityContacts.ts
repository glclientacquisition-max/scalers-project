/**
 * Settings › Identity › How customers reach you: plain rows over social_handles.
 * Storage is unchanged ({ channels: [{ kind, label, value }] }).
 */
import { SOCIAL_CHANNEL_KINDS, type SocialChannel } from "./socialHandles.ts";

export type ContactAddKind = "phone" | "whatsapp" | "social";

/** Kinds offered under "Add social". Phone and WhatsApp have their own buttons. */
export const SOCIAL_KINDS = SOCIAL_CHANNEL_KINDS.filter((k) => k.id !== "phone" && k.id !== "whatsapp");

export function contactKindLabel(kind: string): string {
  return SOCIAL_CHANNEL_KINDS.find((k) => k.id === kind)?.label || "Other";
}

export function contactPlaceholder(kind: string): string {
  return SOCIAL_CHANNEL_KINDS.find((k) => k.id === kind)?.placeholder || "";
}

/** "0712 345 678" for a Kenyan mobile in any stored form; anything else as typed. */
export function formatContactValue(kind: string, value: string): string {
  const raw = String(value || "").trim();
  if (kind !== "phone" && kind !== "whatsapp") return raw;
  const digits = raw.replace(/[^\d+]/g, "");
  const m = /^(?:\+?254|0)([17]\d{2})(\d{3})(\d{3})$/.exec(digits);
  return m ? `0${m[1]} ${m[2]} ${m[3]}` : raw;
}

/** The row's short name: the owner's label when it says more than the kind. */
export function contactRowTitle(channel: Pick<SocialChannel, "kind" | "label">): string {
  const kind = contactKindLabel(channel.kind);
  const label = String(channel.label || "").trim();
  if (!label || label.toLowerCase() === kind.toLowerCase() || /^main$/i.test(label)) return kind;
  return `${kind} · ${label}`;
}

export function newContact(kind: ContactAddKind): SocialChannel {
  if (kind === "social") return { kind: "instagram", label: "", value: "" };
  return { kind, label: "", value: "" };
}
