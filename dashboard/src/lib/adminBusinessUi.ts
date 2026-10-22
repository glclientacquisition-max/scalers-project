import type { AdminBusiness } from "@/lib/admin";
import {
  ARCHIVE_RESTORE_DAYS,
  businessLifecycle,
  releaseBlockReason,
} from "@/lib/adminBusinessModel";
import type { StampTone } from "@/components/ui/Stamp";

const createdLabel = new Intl.DateTimeFormat("en-KE", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "Africa/Nairobi",
});

export function statusLabel(status: AdminBusiness["status"]) {
  if (status === "waiting") return "Waiting";
  if (status === "suspended") return "Suspended";
  if (status === "archived") return "Archived";
  return "Active";
}

export function statusTone(status: AdminBusiness["status"]): StampTone {
  if (status === "waiting" || status === "suspended") return "attention";
  if (status === "active") return "ok";
  return "neutral";
}

export function lifecycleOf(b: AdminBusiness) {
  return businessLifecycle({
    isActive: b.is_active,
    archivedAt: b.archived_at,
    lineStatus: b.line_status,
    suspendedAt: b.suspended_at,
  });
}

export const SUSPENDED_LINE = "Suspended: line unavailable";

export function purgeLabel(b: AdminBusiness) {
  const life = lifecycleOf(b);
  if (life.state !== "archived" || !life.purgesAt) return "Archived before dates were kept. Not purged.";
  const at = new Date(life.purgesAt);
  if (at.getTime() <= Date.now()) return "Purge due";
  return `Purges on ${createdLabel.format(at)}`;
}

export function formatCreated(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return createdLabel.format(date);
}

export function notifyLabel(raw: string) {
  const value = raw.trim();
  if (!value || value === "pending") return "None";
  return value;
}

export function packLabel(b: AdminBusiness) {
  if (!b.package_name) return "None";
  return b.package_period === "year" ? `${b.package_name} / year` : b.package_name;
}

export function planLabel(b: AdminBusiness) {
  return b.billing_enforcement === "off" ? "Beta" : "On-demand";
}

export type PlanChoice = "beta" | "on";

export function planOf(b: AdminBusiness): PlanChoice {
  return b.billing_enforcement === "off" ? "beta" : "on";
}

export function chargeKind(kind: string) {
  if (kind === "call_charge") return "Call";
  if (kind === "line_rental") return "Line";
  if (kind === "admin_adjustment") return "Adjust";
  return kind.replaceAll("_", " ");
}

export function chargeAmount(amount: number) {
  const abs = Math.abs(amount).toLocaleString("en-KE");
  return amount < 0 ? `-KES ${abs}` : `KES ${abs}`;
}

export function phoneLine(b: AdminBusiness) {
  if (b.status === "waiting") return "Waiting";
  const number = b.sautikit_virtual_number.trim();
  if (number.startsWith("pending:")) return "None";
  return number;
}

export function hasLiveNumber(b: AdminBusiness) {
  const number = b.sautikit_virtual_number.trim();
  return Boolean(number) && !number.startsWith("pending:");
}

export function releaseReason(b: AdminBusiness) {
  return releaseBlockReason({ linked: true, businessName: b.business_name, isActive: b.is_active });
}

export function previewLine(b: AdminBusiness) {
  if (b.status === "archived") return purgeLabel(b);
  if (b.status === "suspended") return SUSPENDED_LINE;
  const pack = packLabel(b);
  if (b.status === "waiting") return pack === "None" ? "Waiting" : pack;
  return pack === "None" ? phoneLine(b) : `${phoneLine(b)} · ${pack}`;
}

export { ARCHIVE_RESTORE_DAYS, createdLabel };
