import type { OverviewDataCheck } from "@/components/structured/OverviewDataChecksCard";
import type { ReadyChecklistItem } from "@/lib/assistantSayTypes";

export function reasonNeedsOverviewConfirm(reason: string | undefined): boolean {
  if (!reason) return false;
  return /Imported from your notes|saved but not confirmed/i.test(reason);
}

export function checkKey(c: OverviewDataCheck): string {
  if (c.kind === "link") return `link:${c.href}`;
  if (c.kind === "prices") return `prices:${c.items.map((i) => `${i.kind}:${i.id || i.name}`).join(",")}`;
  if (c.kind === "hours") return "hours";
  return "payments";
}

/** Checklist row id to the overview "Is this right?" sheet for that fact, when present. */
export function confirmCheckForItem(
  itemId: string,
  checks: OverviewDataCheck[]
): OverviewDataCheck | null {
  if (itemId === "catalog") return checks.find((c) => c.kind === "prices") ?? null;
  if (itemId === "payment") return checks.find((c) => c.kind === "payments") ?? null;
  if (itemId === "hours") return checks.find((c) => c.kind === "hours") ?? null;
  return null;
}

export function confirmCheckForReadyItem(
  item: ReadyChecklistItem,
  checks: OverviewDataCheck[]
): OverviewDataCheck | null {
  if (item.complete || !reasonNeedsOverviewConfirm(item.reason)) return null;
  return confirmCheckForItem(item.id, checks);
}
