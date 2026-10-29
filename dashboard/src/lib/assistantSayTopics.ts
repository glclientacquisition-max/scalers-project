import type { AssistantSayRow, AssistantSayState } from "@/lib/assistantSayTypes";
import type { BusinessType } from "@/lib/businessType";

export const ASSISTANT_SAY_PAGE_TITLE = "What callers hear";

export const ASSISTANT_SAY_TOPICS = ["greeting", "prices", "hours", "areas", "payment", "unsure"] as const;
export type AssistantSayTopicId = (typeof ASSISTANT_SAY_TOPICS)[number];

const TOPIC_ORDER = new Map<string, number>(ASSISTANT_SAY_TOPICS.map((id, index) => [id, index]));

export function assistantSayTopicHref(topic: string): string {
  return `/settings?tab=assistant-say&topic=${encodeURIComponent(topic)}`;
}

export function topicTitle(id: string, businessType: BusinessType): string {
  switch (id) {
    case "greeting":
      return "Greeting";
    case "prices":
      return businessType === "retail" ? "Prices" : "Prices and quotes";
    case "hours":
      return "Hours";
    case "areas":
      return businessType === "retail"
        ? "Delivery and areas"
        : businessType === "home_services"
          ? "Areas you cover"
          : "Areas";
    case "payment":
      return "Payment";
    case "unsure":
      return "When unsure";
    default:
      return id;
  }
}

/** Checklist row label aligned with the assistant-say topic list. */
export function readyChecklistLabelForItem(itemId: string, businessType: BusinessType): string {
  if (itemId === "catalog") return topicTitle("prices", businessType);
  if (itemId === "identity") return topicTitle("greeting", businessType);
  return topicTitle(itemId, businessType);
}

export function mapChecklistItemToTopicId(itemId: string): AssistantSayTopicId {
  if (itemId === "catalog") return "prices";
  if (itemId === "identity") return "greeting";
  if (itemId === "hours") return "hours";
  if (itemId === "payment") return "payment";
  if (itemId === "areas") return "areas";
  if (itemId === "greeting") return "greeting";
  if (itemId === "prices") return "prices";
  if (itemId === "unsure") return "unsure";
  return "prices";
}

export function topicNeedsAttention(row: AssistantSayRow): boolean {
  if (row.id === "unsure") return row.stampTone !== "ok";
  if (row.id === "greeting") return !row.willSay;
  return row.isFact ? !row.willSay : row.stampTone === "attention";
}

export function sortAssistantSayRows(rows: AssistantSayRow[]): AssistantSayRow[] {
  return [...rows].sort((a, b) => {
    const na = topicNeedsAttention(a) ? 0 : 1;
    const nb = topicNeedsAttention(b) ? 0 : 1;
    if (na !== nb) return na - nb;
    return (TOPIC_ORDER.get(a.id) ?? 99) - (TOPIC_ORDER.get(b.id) ?? 99);
  });
}

export function applyTopicTitles(state: AssistantSayState, businessType: BusinessType): AssistantSayState {
  const rows = state.rows.map((row) => ({
    ...row,
    title: topicTitle(row.id, businessType),
  }));
  const readyCount = rows.filter((row) => rowIsReady(row)).length;
  return { ...state, rows, readyCount, total: ASSISTANT_SAY_TOPICS.length };
}

export function rowIsReady(row: AssistantSayRow): boolean {
  if (row.id === "unsure") return row.stampTone === "ok";
  if (row.id === "greeting") return row.willSay;
  if (row.isFact) return row.willSay;
  return row.stampTone === "ok";
}

export function topicFixHref(row: AssistantSayRow, returnTo = "/settings?tab=assistant-say"): string {
  if (row.id === "greeting") {
    return `/settings?tab=train&panel=identity&returnTo=${encodeURIComponent(returnTo)}`;
  }
  if (row.id === "unsure") return assistantSayTopicHref("unsure");
  const href = row.fixHref || "/settings";
  if (href.startsWith("http")) return href;
  const path = href.startsWith("/") ? href : `/settings?${href.replace(/^\?/, "")}`;
  const u = new URL(path, "https://desk.local");
  u.searchParams.set("returnTo", returnTo);
  return `${u.pathname}${u.search}${u.hash}`;
}

export function topicLookupKind(topicId: string): string {
  if (topicId === "areas") return "delivery";
  if (topicId === "payment") return "pay";
  return topicId;
}

export function fallbackKindForTopic(topicId: string): "general" | "price" | "hours" | "fee" | "pay" | null {
  if (topicId === "unsure") return "general";
  if (topicId === "prices") return "price";
  if (topicId === "hours") return "hours";
  if (topicId === "areas") return "fee";
  if (topicId === "payment") return "pay";
  return null;
}

export function editCtaLabel(topicId: string): string {
  switch (topicId) {
    case "greeting":
      return "Edit in Identity";
    case "prices":
      return "Edit in Catalogue";
    case "hours":
      return "Edit in Hours";
    case "areas":
      return "Edit in Service areas";
    case "payment":
      return "Edit in Policies";
    default:
      return "Edit";
  }
}
