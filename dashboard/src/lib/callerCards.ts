import { itemIsToReturn } from "@/lib/inboxCounts";
import type { InboxItem, InboxPurpose } from "@/lib/inboxPurpose";

export type CallerChip = { word: string; tone: "ok" | "info" | "warn" | "danger" | "neutral" };

/** Purpose chip from the inbox row. The headline is never rewritten here. */
export function callerChip(item: Pick<InboxItem, "purpose" | "needsYou">): CallerChip {
  if (item.needsYou || item.purpose === "human") return { word: "Call back", tone: "warn" };
  if (item.purpose === "job") return { word: "Visit", tone: "info" };
  if (item.purpose === "hold") return { word: "Hold", tone: "info" };
  if (item.purpose === "missed") return { word: "Missed", tone: "danger" };
  if (item.purpose === "answered") return { word: "Answered", tone: "ok" };
  return { word: "Call", tone: "neutral" };
}

export function callerInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0] ?? "";
  if (parts.length === 1) return first.slice(0, 2).toUpperCase();
  const second = parts[1] ?? "";
  return `${first.slice(0, 1)}${second.slice(0, 1)}`.toUpperCase();
}

export function callerDisplayName(item: Pick<InboxItem, "callerName" | "callerPhone">): string {
  return item.callerName?.trim() || item.callerPhone?.trim() || "Caller";
}

/**
 * Up to three cards. Needs-you first, then newest. The next return is pinned first.
 * When nothing is from today, the latest three earlier callers are used.
 */
export function pickCallerCards(
  items: readonly InboxItem[],
  dayStart: string,
  pinId: string | null,
  limit = 3,
): { latest: boolean; cards: InboxItem[] } {
  const today = items.filter((item) => item.createdAt >= dayStart);
  const earlier = items.filter((item) => item.createdAt < dayStart);
  const pool = today.length > 0 ? today : earlier;
  const latest = today.length === 0 && pool.length > 0;
  const rank = (item: InboxItem) => (itemIsToReturn(item) ? 0 : 1);
  const sorted = pool.toSorted((a, b) => rank(a) - rank(b) || (a.createdAt < b.createdAt ? 1 : -1));
  let cards = sorted.slice(0, limit);
  if (pinId) {
    const pin = items.find((item) => item.id === pinId);
    if (pin) cards = [pin, ...cards.filter((item) => item.id !== pin.id)].slice(0, limit);
  }
  return { latest, cards };
}

export function chipWord(purpose: InboxPurpose): string {
  return callerChip({ purpose, needsYou: purpose === "human" }).word;
}
