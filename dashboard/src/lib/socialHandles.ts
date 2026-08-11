export type SocialHandles = {
  website: string;
  instagram: string;
  facebook: string;
  tiktok: string;
  twitter: string;
  youtube: string;
  whatsapp: string;
  other: string;
};

export const SOCIAL_FIELDS: {
  id: keyof SocialHandles;
  label: string;
  placeholder: string;
}[] = [
  {
    id: "website",
    label: "Website",
    placeholder: "https://yourshop.co.ke",
  },
  {
    id: "instagram",
    label: "Instagram",
    placeholder: "@yourshop",
  },
  {
    id: "facebook",
    label: "Facebook",
    placeholder: "facebook.com/yourshop",
  },
  {
    id: "tiktok",
    label: "TikTok",
    placeholder: "@yourshop",
  },
  {
    id: "twitter",
    label: "X (Twitter)",
    placeholder: "@yourshop",
  },
  {
    id: "youtube",
    label: "YouTube",
    placeholder: "youtube.com/@yourshop",
  },
  {
    id: "whatsapp",
    label: "WhatsApp Business",
    placeholder: "0740 000 000",
  },
  {
    id: "other",
    label: "Other",
    placeholder: "Any other handle or link",
  },
];

export function emptySocialHandles(): SocialHandles {
  return {
    website: "",
    instagram: "",
    facebook: "",
    tiktok: "",
    twitter: "",
    youtube: "",
    whatsapp: "",
    other: "",
  };
}

export function normalizeSocialHandles(raw: unknown): SocialHandles {
  const base = emptySocialHandles();
  if (!raw) return base;
  let obj: Record<string, unknown> = {};
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        obj = parsed as Record<string, unknown>;
      }
    } catch {
      return base;
    }
  } else if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    obj = raw as Record<string, unknown>;
  }
  for (const key of Object.keys(base) as (keyof SocialHandles)[]) {
    base[key] = String(obj[key] ?? "").trim().slice(0, 200);
  }
  // Common aliases from ingest
  if (!base.instagram && obj.ig) base.instagram = String(obj.ig).trim().slice(0, 200);
  if (!base.twitter && (obj.x || obj.X)) {
    base.twitter = String(obj.x || obj.X).trim().slice(0, 200);
  }
  return base;
}

export function parseSocialHandlesField(
  raw: FormDataEntryValue | null
): SocialHandles {
  return normalizeSocialHandles(String(raw || "").trim() || "{}");
}

export function socialHandlesHaveContent(h: SocialHandles): boolean {
  return Object.values(h).some((v) => String(v || "").trim());
}

/** Compact lines for compiler / live ground truth. */
export function formatSocialHandlesForCompiler(h: SocialHandles): string {
  const parts: string[] = [];
  for (const field of SOCIAL_FIELDS) {
    const v = String(h[field.id] || "").trim();
    if (!v) continue;
    parts.push(`- ${field.label}: ${v}`);
  }
  return parts.length ? parts.join("\n") : "";
}
