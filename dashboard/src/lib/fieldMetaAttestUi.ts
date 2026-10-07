import type { BusinessPolicies } from "@/lib/businessPolicies";
import { POLICY_FIELDS } from "@/lib/businessPolicies";
import type { CaptureConfirmRow } from "@/components/CaptureConfirmList";
import type { ProductItem } from "@/lib/productCatalog";
import type { SettingsStatusTarget } from "@/lib/settingsOptionStatus";
import { openDayCount } from "@/lib/settingsOptionStatus";
import type { SocialHandles } from "@/lib/socialHandles";
import { businessSettingsHref, type SettingsPanel } from "@/lib/businessSettingsNav";

/** Client-safe provenance index (sources only). */
export type DeskFieldMetaClient = {
  byPath: Record<string, string>;
} | null;

export function serializeFieldMetaForClient(
  fieldMeta: { byPath?: Record<string, { source?: string }> } | null
): DeskFieldMetaClient {
  if (!fieldMeta?.byPath) return null;
  const byPath: Record<string, string> = {};
  for (const [path, row] of Object.entries(fieldMeta.byPath)) {
    const source = String(row?.source || "").trim().toLowerCase();
    if (source) byPath[path] = source;
  }
  return { byPath };
}

export function metaSourceIsOwner(meta: DeskFieldMetaClient, path: string): boolean {
  return meta?.byPath[path] === "owner";
}

/** Row needs confirm when meta is loaded, value exists, and source is not owner. */
export function pathNeedsOwnerConfirm(
  meta: DeskFieldMetaClient,
  path: string,
  hasValue: boolean,
  jsonOwner = false
): boolean {
  if (!hasValue) return false;
  if (jsonOwner) return false;
  if (!meta) return false;
  return meta.byPath[path] !== "owner";
}

export function pathConfirmed(
  meta: DeskFieldMetaClient,
  path: string,
  jsonOwner = false
): boolean {
  if (jsonOwner) return true;
  return metaSourceIsOwner(meta, path);
}

export type IdentityConfirmInput = {
  businessName: string;
  vertical: string;
  spokenName: string;
  agentName: string;
  agentTone: string;
  socialHandles: SocialHandles;
};

export function identityConfirmRows(
  meta: DeskFieldMetaClient,
  input: IdentityConfirmInput
): CaptureConfirmRow[] {
  const rows: CaptureConfirmRow[] = [];
  const push = (path: string, title: string, preview: string, hasValue: boolean) => {
    if (!hasValue) return;
    rows.push({
      path,
      title,
      preview,
      confirmed: pathConfirmed(meta, path),
    });
  };
  push("identity.business_name", "Business name", input.businessName.trim(), Boolean(input.businessName.trim()));
  push("identity.vertical", "Business type", input.vertical.trim(), Boolean(input.vertical.trim()));
  push("identity.spoken_name", "Spoken name", input.spokenName.trim(), Boolean(input.spokenName.trim()));
  push("assistant.agent_name", "Assistant name", input.agentName.trim(), Boolean(input.agentName.trim()));
  push("assistant.tone", "Tone", input.agentTone.trim(), Boolean(input.agentTone.trim()));
  const social = input.socialHandles.channels.some((c) => String(c.value || "").trim());
  push("identity.social_handles", "Social and web", "On file", social);
  return rows;
}

export function hoursConfirmRows(
  meta: DeskFieldMetaClient,
  schedule: unknown,
  businessHours: string
): CaptureConfirmRow[] {
  const has =
    openDayCount(schedule) > 0 || String(businessHours || "").trim().length >= 8;
  if (!has) return [];
  return [
    {
      path: "hours.weekly_grid",
      title: "Opening hours",
      preview: String(businessHours || "").trim() || "Weekly schedule",
      confirmed: pathConfirmed(meta, "hours.weekly_grid"),
    },
  ];
}

export function locationsConfirmRows(
  meta: DeskFieldMetaClient,
  placeCount: number,
  preview: string
): CaptureConfirmRow[] {
  if (placeCount <= 0) return [];
  return [
    {
      path: "locations.branches",
      title: "Places",
      preview: preview.trim() || `${placeCount} place${placeCount === 1 ? "" : "s"}`,
      confirmed: pathConfirmed(meta, "locations.branches"),
    },
  ];
}

export function alertsConfirmRows(
  meta: DeskFieldMetaClient,
  whatsapp: string,
  email: string
): CaptureConfirmRow[] {
  const rows: CaptureConfirmRow[] = [];
  if (whatsapp.trim()) {
    rows.push({
      path: "team.notify.whatsapp",
      title: "Alert phone",
      preview: whatsapp.trim(),
      confirmed: pathConfirmed(meta, "team.notify.whatsapp"),
    });
  }
  if (email.trim()) {
    rows.push({
      path: "team.notify.email",
      title: "Alert email",
      preview: email.trim(),
      confirmed: pathConfirmed(meta, "team.notify.email"),
    });
  }
  if (whatsapp.trim() || email.trim()) {
    rows.push({
      path: "team.notify.channels",
      title: "Notify channels",
      preview: "WhatsApp, SMS, or email",
      confirmed: pathConfirmed(meta, "team.notify.channels"),
    });
  }
  return rows;
}

function countRows(rows: CaptureConfirmRow[]): number {
  return rows.filter((row) => row.title.trim() && !row.confirmed).length;
}

export function countUnattestedForTarget(
  target: SettingsStatusTarget,
  meta: DeskFieldMetaClient,
  tenant: {
    business_name?: string | null;
    vertical?: string | null;
    spoken_name?: string | null;
    agent_name?: string | null;
    agent_tone?: string | null;
    social_handles?: unknown;
    hours_schedule?: unknown;
    business_hours?: string | null;
    business_locations?: unknown;
    product_catalog?: unknown;
    services_catalog?: unknown;
    faqs?: unknown;
    business_policies?: unknown;
    whatsapp_notification_number?: string | null;
    alert_email?: string | null;
  }
): number {
  if (!meta) return 0;

  if (target.tab === "alerts") {
    return countRows(
      alertsConfirmRows(
        meta,
        String(tenant.whatsapp_notification_number || ""),
        String(tenant.alert_email || "")
      )
    );
  }

  if (target.tab === "catalog") {
    const products = Array.isArray(tenant.product_catalog)
      ? (tenant.product_catalog as ProductItem[])
      : [];
    const services = Array.isArray(tenant.services_catalog)
      ? (tenant.services_catalog as { name?: string; source?: string }[])
      : [];
    let n = 0;
    products.forEach((row, index) => {
      if (!String(row.name || "").trim()) return;
      const sku = String(row.sku || "").trim() || String(index + 1);
      const path = `catalog.product.${sku}.name`;
      if (pathNeedsOwnerConfirm(meta, path, true, row.source === "owner")) n += 1;
    });
    services.forEach((row, index) => {
      if (!String(row.name || "").trim()) return;
      const path = `catalog.service.${index + 1}.name`;
      if (pathNeedsOwnerConfirm(meta, path, true, row.source === "owner")) n += 1;
    });
    return n;
  }

  if (target.tab !== "train") return 0;

  switch (target.panel) {
    case "identity":
      return countRows(
        identityConfirmRows(meta, {
          businessName: String(tenant.business_name || ""),
          vertical: String(tenant.vertical || ""),
          spokenName: String(tenant.spoken_name || ""),
          agentName: String(tenant.agent_name || ""),
          agentTone: String(tenant.agent_tone || ""),
          socialHandles: normalizeSocialForCount(tenant.social_handles),
        })
      );
    case "hours":
      return countRows(
        hoursConfirmRows(meta, tenant.hours_schedule, String(tenant.business_hours || ""))
      );
    case "locations": {
      const places = Array.isArray(tenant.business_locations) ? tenant.business_locations.length : 0;
      return countRows(locationsConfirmRows(meta, places, ""));
    }
    case "faqs": {
      const faqs = Array.isArray(tenant.faqs) ? tenant.faqs : [];
      let n = 0;
      faqs.forEach((row, index) => {
        if (!row || typeof row !== "object") return;
        const q = String((row as { question?: string }).question || "").trim();
        const a = String((row as { answer?: string }).answer || "").trim();
        if (!q || !a) return;
        const path = `faqs.${index + 1}`;
        const jsonOwner = String((row as { source?: string }).source || "").toLowerCase() === "owner";
        if (pathNeedsOwnerConfirm(meta, path, true, jsonOwner)) n += 1;
      });
      return n;
    }
    case "policies": {
      const policies = (tenant.business_policies || {}) as BusinessPolicies;
      let n = 0;
      for (const field of POLICY_FIELDS) {
        const text = String(policies[field.id] || "").trim();
        if (!text) continue;
        const path = `policies.${field.id}`;
        const prov = policies.provenance?.[field.id];
        const jsonOwner = prov?.source === "owner" || prov?.confirmed === true;
        if (pathNeedsOwnerConfirm(meta, path, true, jsonOwner)) n += 1;
      }
      return n;
    }
    default:
      return 0;
  }
}

function normalizeSocialForCount(raw: unknown): SocialHandles {
  if (!raw || typeof raw !== "object") return { channels: [] };
  const channels = (raw as SocialHandles).channels;
  return Array.isArray(channels) ? { channels } : { channels: [] };
}

export function settingsAttestNavLabel(
  count: number
): string {
  if (count <= 0) return "";
  return count === 1 ? "1 to confirm" : `${count} to confirm`;
}

export function settingsHrefForGapDomain(domain: string | undefined): string {
  if (domain === "catalog") return businessSettingsHref("catalog");
  if (domain === "team_notify") return businessSettingsHref("alerts");
  if (domain === "bulletin") return "/home#updates";
  if (domain === "assistant") return businessSettingsHref("train", "tools");
  if (domain === "payments" || domain === "policies") {
    return businessSettingsHref("train", "policies");
  }
  const trainPanels = new Set<string>(["identity", "hours", "locations", "faqs", "tools"]);
  if (domain && trainPanels.has(domain)) {
    return businessSettingsHref("train", domain as SettingsPanel);
  }
  if (domain === "faqs") return businessSettingsHref("train", "faqs");
  return businessSettingsHref("train");
}

export function totalUnattestedCount(
  meta: DeskFieldMetaClient,
  tenant: Parameters<typeof countUnattestedForTarget>[2],
  targets: SettingsStatusTarget[]
): number {
  if (!meta) return 0;
  return targets.reduce((sum, target) => sum + countUnattestedForTarget(target, meta, tenant), 0);
}
