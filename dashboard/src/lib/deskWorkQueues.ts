import { businessSettingsHref } from "@/lib/businessSettingsNav";
import type { LineStatusId } from "@/lib/lineStatus";

export type DeskWorkCounts = {
  newCalls: number;
  openRequests: number;
  visitsToConfirm: number;
};

export type DeskWorkQueue = {
  id: "calls" | "requests" | "appointments";
  label: string;
  href: string;
  count: number;
  unit: string;
};

export function deskWorkQueues(counts: DeskWorkCounts): DeskWorkQueue[] {
  return [
    {
      id: "calls",
      label: "Calls",
      href: "/calls",
      count: counts.newCalls,
      unit: "new",
    },
    {
      id: "requests",
      label: "Requests",
      href: "/requests",
      count: counts.openRequests,
      unit: "open",
    },
    {
      id: "appointments",
      label: "Appointments",
      href: "/appointments",
      count: counts.visitsToConfirm,
      unit: "to confirm",
    },
  ];
}

export function deskNextAction(
  counts: DeskWorkCounts,
  line: LineStatusId
): { href: string; label: string } | null {
  if (counts.newCalls > 0) {
    return { href: "/calls", label: "Open new calls" };
  }
  if (counts.openRequests > 0) {
    return { href: "/requests", label: "Fulfill requests" };
  }
  if (counts.visitsToConfirm > 0) {
    return { href: "/appointments", label: "Confirm visits" };
  }
  if (line === "needs_training") {
    return { href: businessSettingsHref("train"), label: "Train" };
  }
  if (line === "pending") return null;
  return { href: businessSettingsHref("test"), label: "Test line" };
}

export function requestWhatsAppMessage(opts: {
  businessName: string;
  name: string | null;
  type: string;
  item: string | null;
}): string {
  const who = opts.name?.trim() || "there";
  const biz = opts.businessName.trim() || "us";
  const item = opts.item?.trim();
  if (item) {
    return `Hi ${who}, this is ${biz}. About your ${opts.type} for ${item}.`;
  }
  return `Hi ${who}, this is ${biz}. About your ${opts.type}.`;
}

export function visitWhatsAppMessage(opts: {
  businessName: string;
  name: string | null;
  service: string;
  when: string | null;
}): string {
  const who = opts.name?.trim() || "there";
  const biz = opts.businessName.trim() || "us";
  const when = opts.when?.trim();
  const service = opts.service.trim() || "visit";
  if (when) {
    return `Hi ${who}, this is ${biz}. Confirming your ${service}, ${when}.`;
  }
  return `Hi ${who}, this is ${biz}. Confirming your ${service}.`;
}
