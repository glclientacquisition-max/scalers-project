export type SettingsStatusVoice = {
  id: string;
  description?: string;
  default?: boolean;
};

export type SettingsStatusTenant = {
  agent_name?: string | null;
  sautikit_virtual_number?: string | null;
  soniox_voice_id?: string | null;
  soniox_voice_label?: string | null;
  hours_schedule?: unknown;
  faqs?: unknown;
  services_catalog?: unknown;
  product_catalog?: unknown;
  team_directory?: unknown;
  business_locations?: unknown;
  tts_lexicon?: unknown;
};

type SettingsStatusTarget =
  | { tab: "catalog" | "import" | "test" | "alerts" }
  | { tab: "train"; panel: string };

const DAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

export function settingsStatusKey(target: SettingsStatusTarget): string {
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

function voiceStatus(
  tenant: SettingsStatusTenant,
  voices: SettingsStatusVoice[]
): string {
  const custom = String(tenant.soniox_voice_label || "").trim();
  if (custom) return custom;
  const id = String(tenant.soniox_voice_id || "").trim();
  const match = voices.find((voice) => voice.id === id);
  if (match?.description) return match.description;
  return "";
}

export function settingsOptionStatus(
  target: SettingsStatusTarget,
  tenant: SettingsStatusTenant,
  voices: SettingsStatusVoice[] = []
): string {
  if (target.tab === "test") {
    const did = String(tenant.sautikit_virtual_number || "").trim();
    return did && !/^pending:/i.test(did) ? "Line live" : "";
  }
  if (target.tab === "catalog") {
    const count =
      namedCount(tenant.services_catalog) + namedCount(tenant.product_catalog);
    return count ? String(count) : "";
  }
  if (target.tab !== "train") return "";
  switch (target.panel) {
    case "hours": {
      const days = openDayCount(tenant.hours_schedule);
      return days ? `${days} day${days === 1 ? "" : "s"}` : "";
    }
    case "tools":
      return voiceStatus(tenant, voices);
    case "faqs": {
      const count = faqCount(tenant.faqs);
      return count ? String(count) : "";
    }
    case "team": {
      const count = namedCount(tenant.team_directory);
      return count ? String(count) : "";
    }
    case "locations": {
      const count = placeCount(tenant.business_locations);
      return count ? String(count) : "";
    }
    case "identity": {
      const name = String(tenant.agent_name || "").trim();
      return name && !/^receptionist$/i.test(name) ? name : "";
    }
    case "pronunciation": {
      const count = Array.isArray(tenant.tts_lexicon) ? tenant.tts_lexicon.length : 0;
      return count ? String(count) : "";
    }
    default:
      return "";
  }
}

/** Short row statuses for the Settings list. One string per destination. */
export function settingsIndexStatuses(
  tenant: SettingsStatusTenant,
  voices: SettingsStatusVoice[],
  targets: SettingsStatusTarget[]
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const target of targets) {
    const status = settingsOptionStatus(target, tenant, voices);
    if (status) out[settingsStatusKey(target)] = status;
  }
  return out;
}
