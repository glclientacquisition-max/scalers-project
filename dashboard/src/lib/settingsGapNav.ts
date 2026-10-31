import { businessSettingsHref, type SettingsPanel } from "@/lib/businessSettingsNav";

/** Map completeness gap domain to Settings URL. */
export function settingsHrefForGapDomain(domain: string | undefined): string {
  if (domain === "catalog") return businessSettingsHref("catalog");
  if (domain === "team_notify") return businessSettingsHref("alerts");
  if (domain === "bulletin") return "/home#updates";
  if (domain === "assistant") return businessSettingsHref("train", "tools");
  // Payments lands on (and focuses) the payments card.
  if (domain === "payments") return `${businessSettingsHref("train", "policies")}#payments`;
  if (domain === "policies") return businessSettingsHref("train", "policies");
  const trainPanels = new Set<string>(["identity", "hours", "locations", "faqs", "tools"]);
  if (domain && trainPanels.has(domain)) {
    return businessSettingsHref("train", domain as SettingsPanel);
  }
  if (domain === "faqs") return businessSettingsHref("train", "faqs");
  return businessSettingsHref("train");
}
