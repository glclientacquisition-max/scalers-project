/** One public contact / social channel (phone, WhatsApp, Instagram, etc.). */
export type SocialChannel = {
  /** phone | whatsapp | website | instagram | facebook | tiktok | twitter | youtube | email | other */
  kind: string;
  /** e.g. Main, Sales, Orders, Delivery */
  label: string;
  /** Number, @handle, URL, or free text */
  value: string;
};

export type SocialHandles = {
  channels: SocialChannel[];
};

export const SOCIAL_CHANNEL_KINDS: {
  id: string;
  label: string;
  placeholder: string;
}[] = [
  { id: "phone", label: "Phone", placeholder: "0740 000 000" },
  { id: "whatsapp", label: "WhatsApp", placeholder: "0740 000 000" },
  { id: "website", label: "Website", placeholder: "https://yourshop.co.ke" },
  { id: "instagram", label: "Instagram", placeholder: "@yourshop" },
  { id: "facebook", label: "Facebook", placeholder: "facebook.com/yourshop" },
  { id: "tiktok", label: "TikTok", placeholder: "@yourshop" },
  { id: "twitter", label: "X (Twitter)", placeholder: "@yourshop" },
  { id: "youtube", label: "YouTube", placeholder: "youtube.com/@yourshop" },
  { id: "email", label: "Email", placeholder: "hello@yourshop.co.ke" },
  { id: "other", label: "Other", placeholder: "Any other link or handle" },
];

export const SOCIAL_CHANNELS_MAX = 24;

const KIND_SET = new Set(SOCIAL_CHANNEL_KINDS.map((k) => k.id));

export function emptySocialChannel(
  kind = "phone",
  label = "Main"
): SocialChannel {
  return { kind, label, value: "" };
}

export function emptySocialHandles(): SocialHandles {
  return { channels: [] };
}

function splitMulti(raw: string): string[] {
  return String(raw || "")
    .split(/[\n,;|]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function normalizeKind(raw: unknown): string {
  const k = String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");
  if (k === "x" || k === "twitterx") return "twitter";
  if (k === "ig") return "instagram";
  if (k === "web" || k === "url" || k === "site") return "website";
  if (k === "wa" || k === "whatsappbusiness") return "whatsapp";
  if (k === "tel" || k === "mobile" || k === "call") return "phone";
  if (KIND_SET.has(k)) return k;
  return "other";
}

function kindLabel(kind: string): string {
  return SOCIAL_CHANNEL_KINDS.find((k) => k.id === kind)?.label || "Other";
}

/** Push unique channel (same kind+value). */
function pushChannel(
  channels: SocialChannel[],
  kind: string,
  value: string,
  label = ""
) {
  const v = String(value || "").trim().slice(0, 200);
  if (!v) return;
  const k = normalizeKind(kind);
  const exists = channels.some(
    (c) => c.kind === k && c.value.toLowerCase() === v.toLowerCase()
  );
  if (exists) return;
  channels.push({
    kind: k,
    label: String(label || "").trim().slice(0, 40) || kindLabel(k),
    value: v,
  });
}

/**
 * Accepts:
 * - new shape { channels: [...] }
 * - legacy flat { website, instagram, whatsapp, ... } (comma-separated multi OK)
 * - array of channel objects
 */
export function normalizeSocialHandles(raw: unknown): SocialHandles {
  const channels: SocialChannel[] = [];
  if (!raw) return { channels };

  let obj: unknown = raw;
  if (typeof raw === "string") {
    try {
      obj = JSON.parse(raw);
    } catch {
      // Plain phone / handle pasted as string
      pushChannel(channels, "other", raw);
      return { channels };
    }
  }

  if (Array.isArray(obj)) {
    for (const row of obj) {
      if (!row || typeof row !== "object") continue;
      const r = row as Record<string, unknown>;
      pushChannel(
        channels,
        String(r.kind || r.platform || r.type || "other"),
        String(r.value || r.handle || r.url || r.number || r.phone || ""),
        String(r.label || r.name || "")
      );
    }
    return { channels: channels.slice(0, SOCIAL_CHANNELS_MAX) };
  }

  if (!obj || typeof obj !== "object") return { channels };

  const root = obj as Record<string, unknown>;

  // New shape
  if (Array.isArray(root.channels)) {
    for (const row of root.channels) {
      if (!row || typeof row !== "object") continue;
      const r = row as Record<string, unknown>;
      pushChannel(
        channels,
        String(r.kind || r.platform || "other"),
        String(r.value || r.handle || r.url || r.number || ""),
        String(r.label || "")
      );
    }
  }

  // Legacy phones array
  if (Array.isArray(root.phones)) {
    for (const row of root.phones) {
      if (typeof row === "string") {
        pushChannel(channels, "phone", row, "Main");
        continue;
      }
      if (!row || typeof row !== "object") continue;
      const r = row as Record<string, unknown>;
      const num = String(r.number || r.value || r.phone || "").trim();
      const label = String(r.label || r.name || "Main");
      const asWa = Boolean(r.whatsapp || r.is_whatsapp);
      pushChannel(channels, asWa ? "whatsapp" : "phone", num, label);
      if (asWa && r.also_phone) {
        pushChannel(channels, "phone", num, label);
      }
    }
  }

  // Legacy flat string fields (multi via comma/newline)
  const flatKeys = [
    "website",
    "instagram",
    "facebook",
    "tiktok",
    "twitter",
    "youtube",
    "whatsapp",
    "phone",
    "email",
    "other",
  ] as const;
  for (const key of flatKeys) {
    const val = root[key];
    if (val == null) continue;
    if (Array.isArray(val)) {
      for (const item of val) pushChannel(channels, key, String(item));
      continue;
    }
    for (const part of splitMulti(String(val))) {
      pushChannel(channels, key, part);
    }
  }

  // Aliases
  if (root.ig) {
    for (const part of splitMulti(String(root.ig))) {
      pushChannel(channels, "instagram", part);
    }
  }
  if (root.x || root.X) {
    for (const part of splitMulti(String(root.x || root.X))) {
      pushChannel(channels, "twitter", part);
    }
  }

  return { channels: channels.slice(0, SOCIAL_CHANNELS_MAX) };
}

export function parseSocialHandlesField(
  raw: FormDataEntryValue | null
): SocialHandles {
  return normalizeSocialHandles(String(raw || "").trim() || "{}");
}

export function socialHandlesHaveContent(h: SocialHandles | null | undefined): boolean {
  return Boolean(h?.channels?.some((c) => String(c.value || "").trim()));
}

export function formatSocialHandlesForCompiler(h: SocialHandles): string {
  const channels = normalizeSocialHandles(h).channels.filter((c) =>
    String(c.value || "").trim()
  );
  if (!channels.length) return "";

  const phones = channels.filter((c) => c.kind === "phone" || c.kind === "whatsapp");
  const socials = channels.filter((c) => c.kind !== "phone" && c.kind !== "whatsapp");

  const parts: string[] = [];
  if (phones.length) {
    parts.push("Phones / WhatsApp:");
    for (const c of phones) {
      const kind = c.kind === "whatsapp" ? "WhatsApp" : "Phone";
      const label = c.label && c.label !== kind ? ` (${c.label})` : "";
      parts.push(`- ${kind}${label}: ${c.value}`);
    }
  }
  if (socials.length) {
    if (parts.length) parts.push("");
    parts.push("Social & web:");
    for (const c of socials) {
      const kind = kindLabel(c.kind);
      const label =
        c.label && c.label !== kind ? ` (${c.label})` : "";
      parts.push(`- ${kind}${label}: ${c.value}`);
    }
  }
  return parts.join("\n");
}

/** Convenience: first WhatsApp or phone for owner alerts fallback. */
export function primaryWhatsappOrPhone(h: SocialHandles): string {
  const channels = normalizeSocialHandles(h).channels;
  const wa = channels.find((c) => c.kind === "whatsapp" && c.value);
  if (wa) return wa.value;
  const phone = channels.find((c) => c.kind === "phone" && c.value);
  return phone?.value || "";
}
