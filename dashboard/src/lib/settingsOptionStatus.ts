import type { SettingsNavTarget } from "@/lib/businessSettingsNav";

export type SettingsStatusVoice = {
  id: string;
  description?: string;
  default?: boolean;
};

export type SettingsStatusTenant = {
  business_name?: string | null;
  spoken_name?: string | null;
  vertical?: string | null;
  agent_name?: string | null;
  agent_tone?: string | null;
  sautikit_virtual_number?: string | null;
  whatsapp_notification_number?: string | null;
  alert_email?: string | null;
  social_handles?: unknown;
  business_policies?: unknown;
  product_catalog?: unknown;
  soniox_voice_id?: string | null;
  soniox_voice_label?: string | null;
  /** Stored call setup option, when the settings page has read it. */
  call_option?: "forward" | "main_number" | null;
  notify_channels?: unknown;
  hours_schedule?: unknown;
  faqs?: unknown;
  services_catalog?: unknown;
  team_directory?: unknown;
  business_locations?: unknown;
  tts_lexicon?: unknown;
};

const DAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

export function settingsStatusKey(target: SettingsNavTarget): string {
  if ("href" in target) return target.href;
  return target.tab === "train" ? `train:${target.panel}` : target.tab;
}

export function openDayCount(schedule: unknown): number {
  let obj: unknown = schedule;
  if (typeof schedule === "string") {
    try {
      obj = JSON.parse(schedule);
    } catch {
      return 0;
    }
  }
  if (!obj || typeof obj !== "object") return 0;
  const root = obj as { days?: unknown };
  const days =
    root.days && typeof root.days === "object" ? root.days : root;
  let count = 0;
  for (const key of DAY_KEYS) {
    const day = (days as Record<string, unknown>)[key];
    if (!day || typeof day !== "object") continue;
    const slot = day as { open?: unknown; close?: unknown };
    const open = String(slot.open || "").trim();
    const close = String(slot.close || "").trim();
    if (open && close && open < close) count += 1;
  }
  return count;
}

function namedCount(rows: unknown): number {
  if (!Array.isArray(rows)) return 0;
  return rows.filter((row) => {
    if (!row || typeof row !== "object") return false;
    return String((row as { name?: unknown }).name || "").trim().length > 0;
  }).length;
}

function faqCount(rows: unknown): number {
  if (!Array.isArray(rows)) return 0;
  return rows.filter((row) => {
    if (!row || typeof row !== "object") return false;
    const faq = row as { question?: unknown; answer?: unknown };
    return String(faq.question || "").trim() && String(faq.answer || "").trim();
  }).length;
}

function placeCount(rows: unknown): number {
  if (!Array.isArray(rows)) return 0;
  return rows.filter((row) => {
    if (!row || typeof row !== "object") return false;
    const place = row as { label?: unknown; address?: unknown };
    return String(place.label || "").trim() || String(place.address || "").trim();
  }).length;
}

/** Rail width fits about sixteen characters before the chevron. */
const STATUS_MAX = 16;

function countLabel(count: number, one: string, many: string): string {
  if (!count) return "";
  return count === 1 ? `1 ${one}` : `${count} ${many}`;
}

function fitsStatus(value: string): string {
  const text = value.replace(/\s+/g, " ").trim();
  if (text.length <= STATUS_MAX) return text;
  const words = text.split(" ");
  let phrase = words[0] || text.slice(0, STATUS_MAX);
  for (let i = 1; i < words.length; i += 1) {
    const next = `${phrase} ${words[i]}`;
    if (next.length > STATUS_MAX) break;
    phrase = next;
  }
  return phrase;
}

function voiceFull(
  tenant: SettingsStatusTenant,
  voices: SettingsStatusVoice[]
): string {
  const id = String(tenant.soniox_voice_id || "").trim();
  const match = voices.find((voice) => voice.id === id);
  const catalog = String(match?.description || "").trim();
  if (catalog) return catalog;
  const agent = String(tenant.agent_name || "").trim().toLowerCase();
  const custom = String(tenant.soniox_voice_label || "").trim();
  if (custom && custom.toLowerCase() !== agent) return custom;
  return "";
}

function voiceStatus(
  tenant: SettingsStatusTenant,
  voices: SettingsStatusVoice[]
): string {
  return fitsStatus(voiceFull(tenant, voices));
}

/**
 * The business name, or Needs setup while it is missing. The greeting is
 * Automatic by default, so an empty greeting is not missing.
 */
function identityStatus(tenant: SettingsStatusTenant): string {
  const name = String(tenant.business_name || "").trim();
  return name ? fitsStatus(name) : NEEDS_SETUP;
}

/** Shown where the Business Assistant cannot answer well until the owner fills it in. */
export const NEEDS_SETUP = "Needs setup";

function catalogStatus(tenant: SettingsStatusTenant): string {
  const services = namedCount(tenant.services_catalog);
  const products = namedCount(tenant.product_catalog);
  if (services && products) return countLabel(services + products, "item", "items");
  if (services) return countLabel(services, "service", "services");
  if (products) return countLabel(products, "product", "products");
  return NEEDS_SETUP;
}

function areaPlaceName(id: string): string {
  const slug = id.split(":").pop() || id;
  const words = slug.replace(/[_-]+/g, " ").trim();
  if (!words) return "";
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** "Nairobi +8" from the stored coverage list. Empty when that list is absent. */
function areasStatus(tenant: SettingsStatusTenant): string {
  const policies = tenant.business_policies;
  if (!policies || typeof policies !== "object") return "";
  const coverage = (policies as { coverage_areas?: unknown }).coverage_areas;
  if (!Array.isArray(coverage)) return "";
  const names = coverage.map((id) => areaPlaceName(String(id || ""))).filter(Boolean);
  if (!names.length) return "";
  if (names.length === 1) return fitsStatus(names[0]);
  return fitsStatus(`${names[0]} +${names.length - 1}`);
}

function policiesStatus(tenant: SettingsStatusTenant): string {
  const policies = tenant.business_policies;
  if (!policies || typeof policies !== "object") return "";
  const payments = (policies as { payments?: { methods?: unknown } }).payments;
  if (!payments || typeof payments !== "object" || !Array.isArray(payments.methods)) return "";
  const count = payments.methods.filter((method) => String(method || "").trim()).length;
  if (!count) return "";
  return count === 1 ? "1 way to pay" : `${count} ways to pay`;
}

/** Home row for Calls. Blank until the stored setup option is known. */
export function callsRowStatus(option: string | null | undefined): string {
  if (option === "forward") return "Forwarding on";
  if (option === "main_number") return "Your number";
  return "";
}

function alertsStatus(raw: unknown): string {
  if (!raw || typeof raw !== "object") return "";
  const channels = raw as Record<string, unknown>;
  const on = [channels.sms ? "SMS" : "", channels.whatsapp ? "WhatsApp" : "", channels.email ? "Email" : ""].filter(Boolean);
  if (on.length) return on.join(" · ");
  if ("sms" in channels || "whatsapp" in channels || "email" in channels) return "Off";
  return "";
}

export function settingsOptionStatus(
  target: SettingsNavTarget,
  tenant: SettingsStatusTenant,
  voices: SettingsStatusVoice[] = []
): string {
  if ("href" in target) {
    if (target.href === "/settings/areas") return areasStatus(tenant);
    if (target.href === "/settings/knowledge") return catalogStatus(tenant);
    return "";
  }
  if (target.tab === "catalog") return catalogStatus(tenant);
  if (target.tab === "test") {
    const did = String(tenant.sautikit_virtual_number || "").trim();
    return did && !/^pending:/i.test(did) ? "Line live" : "Not live yet";
  }
  if (target.tab === "calls") return callsRowStatus(tenant.call_option);
  if (target.tab === "alerts") return alertsStatus(tenant.notify_channels);
  if (target.tab !== "train") return "";
  switch (target.panel) {
    case "hours": {
      const days = openDayCount(tenant.hours_schedule);
      return days ? `${days} day${days === 1 ? "" : "s"}` : NEEDS_SETUP;
    }
    case "tools":
      return voiceStatus(tenant, voices);
    case "faqs":
      return countLabel(faqCount(tenant.faqs), "question", "questions") || NEEDS_SETUP;
    case "team":
      return countLabel(namedCount(tenant.team_directory), "person", "people");
    case "locations":
      return countLabel(placeCount(tenant.business_locations), "place", "places");
    case "identity":
      return identityStatus(tenant);
    case "policies":
      return policiesStatus(tenant);
    case "pronunciation":
      return countLabel(
        Array.isArray(tenant.tts_lexicon) ? tenant.tts_lexicon.length : 0,
        "word",
        "words"
      );
    default:
      return "";
  }
}

export type SettingsListStatus = {
  text: string;
  /** Full fact when the row shows a shorter voice or name. */
  title: string;
  /** Attention only for a real warning. Quiet otherwise. */
  tone?: "quiet" | "attention";
};

/** Short row statuses for the Settings list. One fact per destination. */
export function settingsIndexStatuses(
  tenant: SettingsStatusTenant,
  voices: SettingsStatusVoice[],
  targets: SettingsNavTarget[]
): Record<string, SettingsListStatus> {
  const out: Record<string, SettingsListStatus> = {};
  for (const target of targets) {
    const key = settingsStatusKey(target);
    const text = settingsOptionStatus(target, tenant, voices);
    if (!text) continue;
    const title =
      "tab" in target && target.tab === "train" && target.panel === "tools"
        ? voiceFull(tenant, voices) || text
        : text;
    out[key] = { text, title };
  }
  return out;
}
