"use client";

import { useActionState, useEffect, useMemo, useState, type ReactNode } from "react";
import type { FaqEntry, TeamDirectoryEntry, TenantRow } from "@/lib/supabase";
import type { OnboardingTone } from "@/lib/onboarding";
import { TONE_LABELS } from "@/lib/onboarding";
import {
  DAY_LABELS,
  DAY_ORDER,
  formatHoursForCompiler,
  scheduleForForm,
  type DayKey,
  type HoursSchedule,
} from "@/lib/hoursSchedule";
import {
  AFTER_HOURS_OPTIONS,
  parseAfterHoursMode,
  type AfterHoursMode,
} from "@/lib/afterHours";
import {
  AGENT_TOOL_OPTIONS,
  parseAgentTools,
  type AgentTools,
} from "@/lib/agentTools";
import {
  emptyService,
  extractServicesNotes,
  formatServicesForCompiler,
  normalizeServicesCatalog,
  parseBulkServices,
  type ServiceItem,
} from "@/lib/servicesCatalog";
import {
  emptyProduct,
  formatProductsForCompiler,
  normalizeProductCatalog,
  parseBulkProducts,
  PRODUCT_CATALOG_MAX,
  type ProductItem,
} from "@/lib/productCatalog";
import {
  emptySocialChannel,
  normalizeSocialHandles,
  SOCIAL_CHANNEL_KINDS,
  SOCIAL_CHANNELS_MAX,
  type SocialChannel,
  type SocialHandles,
} from "@/lib/socialHandles";
import {
  saveAndCompileSettings,
  type SettingsCompileState,
} from "@/app/(desk)/settings/actions";
import {
  FAQ_ANSWER_MAX,
  FAQ_MAX,
  FAQ_QUESTION_MAX,
  FAQ_STARTERS,
  normalizeFaqKey,
} from "@/lib/faqs";
import {
  parseVertical,
  VERTICAL_OPTIONS,
  type BusinessVertical,
} from "@/lib/vertical";
import {
  HANDOFF_OPTIONS,
  parseHandoffMode,
  type HandoffMode,
} from "@/lib/handoffMode";
import {
  displaySonioxVoiceLabel,
  getDefaultSonioxVoiceIdSync,
  listCuratedSonioxVoicesSync,
  type CuratedSonioxVoice,
} from "@/lib/sonioxVoiceCatalog";
import {
  emptyLocation,
  LOCATIONS_MAX,
  normalizeBusinessLocations,
  type BusinessLocation,
} from "@/lib/businessLocations";
import {
  normalizeBusinessPolicies,
  POLICY_FIELDS,
  type BusinessPolicies,
} from "@/lib/businessPolicies";
import { PronunciationCoach } from "@/components/PronunciationCoach";
import {
  ExpandTextarea,
  ToolSwitch,
  TrashIcon,
  settingsChipClass,
  settingsDenseFieldClass,
  settingsFieldClass,
  settingsStickyHeaderClass,
  settingsTableFieldClass,
} from "@/components/settingsUi";
import {
  TenantSettingsSaveButton,
  TENANT_SETTINGS_FORM_ID,
} from "@/components/TenantSettingsSaveButton";
import {
  parseTtsLexicon,
  lexiconForStorage,
  type TtsLexiconEntry,
} from "@/lib/pronunciationLexicon";
import type { SettingsPanel } from "@/lib/businessSettingsNav";

export type { SettingsPanel } from "@/lib/businessSettingsNav";

const TONE_OPTIONS: { id: OnboardingTone; blurb: string }[] = [
  {
    id: "professional",
    blurb: "Calm and clear",
  },
  {
    id: "friendly",
    blurb: "Warm and helpful",
  },
  {
    id: "empathetic",
    blurb: "Steady and caring",
  },
  {
    id: "localized",
    blurb: "Natural Kenyan voice",
  },
];

function initialSonioxVoiceId(
  tenant: TenantRow,
  curated: CuratedSonioxVoice[]
): string {
  const raw = String(tenant.soniox_voice_id || "").trim();
  if (raw && curated.some((v) => v.id === raw)) return raw;
  const marked = curated.find((v) => v.default);
  return marked?.id || curated[0]?.id || getDefaultSonioxVoiceIdSync() || "";
}

function initialTone(tenant: TenantRow): OnboardingTone | "" {
  const t = String(tenant.agent_tone || "").toLowerCase();
  if (
    t === "professional" ||
    t === "friendly" ||
    t === "empathetic" ||
    t === "localized"
  ) {
    return t;
  }
  return "";
}

function normalizeTeam(raw: TenantRow["team_directory"]): TeamDirectoryEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((row) => ({
      name: String(row?.name || "").trim(),
      role: String(row?.role || "").trim(),
      phone: String(row?.phone || "").trim(),
      email: String(row?.email || "").trim().toLowerCase(),
    }))
    .filter((row) => row.name || row.role || row.phone || row.email);
}

function normalizeFaqs(raw: TenantRow["faqs"]): FaqEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((row) => ({
      question: String(row?.question || "").trim(),
      answer: String(row?.answer || "").trim(),
    }))
    .filter((row) => row.question || row.answer);
}

const emptyMember = (): TeamDirectoryEntry => ({
  name: "",
  role: "",
  phone: "",
  email: "",
});
const emptyFaq = (): FaqEntry => ({ question: "", answer: "" });

/** Pull location prose from legacy free-text hours when schedule.location is empty. */
function extractLocationFallback(businessHours: string): string {
  const text = String(businessHours || "").trim();
  if (!text) return "";
  const loc = text.match(/location\s*[/:]?\s*(.+)$/i);
  if (loc?.[1]) return loc[1].trim();
  // If it looks like a schedule summary only, skip.
  if (/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)/i.test(text) && text.length < 180) {
    return "";
  }
  return text;
}

const initial: SettingsCompileState = {};

const fieldClass = settingsFieldClass;
const tableFieldClass = settingsTableFieldClass;
const denseFieldClass = settingsDenseFieldClass;
const choiceChipClass = settingsChipClass;

function PolicyTextarea({
  id,
  value,
  onChange,
  placeholder,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  return (
    <ExpandTextarea
      id={id}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
    />
  );
}

const SERVICE_PAGE_SIZE = 5;
const PRODUCT_PAGE_SIZE = 8;
const FAQ_PAGE_SIZE = 5;

function CatalogPager({
  page,
  pageSize,
  total,
  noun,
  onPrev,
  onNext,
}: {
  page: number;
  pageSize: number;
  total: number;
  noun: string;
  onPrev: () => void;
  onNext: () => void;
}) {
  if (total <= 0) return null;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const from = page * pageSize + 1;
  const to = Math.min(total, (page + 1) * pageSize);
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line bg-surface-canvas px-3 py-3">
      <p className="text-xs text-ink-soft">
        {from}–{to} of {total} {noun}
        {total === 1 ? "" : "s"}
      </p>
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={page <= 0}
          onClick={onPrev}
          className="rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-ink disabled:opacity-40"
        >
          Previous
        </button>
        <span className="text-xs text-ink-soft">
          {page + 1} / {pageCount}
        </span>
        <button
          type="button"
          disabled={page >= pageCount - 1}
          onClick={onNext}
          className="rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-ink disabled:opacity-40"
        >
          Next
        </button>
      </div>
    </div>
  );
}

export function TenantForm({
  tenant,
  panel = "identity",
  curatedVoices,
  heading = null,
  lineNumber = "",
  sidebar = null,
}: {
  tenant: TenantRow;
  panel?: SettingsPanel;
  curatedVoices?: CuratedSonioxVoice[];
  heading?: string | null;
  lineNumber?: string;
  sidebar?: ReactNode;
}) {
  const voiceOptions =
    curatedVoices && curatedVoices.length
      ? curatedVoices
      : listCuratedSonioxVoicesSync();
  const [businessName, setBusinessName] = useState(tenant.business_name || "");
  const [ownerWhatsapp, setOwnerWhatsapp] = useState(
    tenant.whatsapp_notification_number || ""
  );
  const [alertEmail, setAlertEmail] = useState(tenant.alert_email || "");
  const [servicesNotes, setServicesNotes] = useState(() =>
    extractServicesNotes(tenant.services_offered || "")
  );
  const [services, setServices] = useState<ServiceItem[]>(() => {
    const rows = normalizeServicesCatalog(tenant.services_catalog);
    return rows.length ? rows : [emptyService()];
  });
  const [products, setProducts] = useState<ProductItem[]>(() => {
    const rows = normalizeProductCatalog(tenant.product_catalog);
    return rows.length ? rows : [];
  });
  const [socialHandles, setSocialHandles] = useState<SocialHandles>(() =>
    normalizeSocialHandles(tenant.social_handles)
  );
  const [showBulkServices, setShowBulkServices] = useState(false);
  const [bulkServicesText, setBulkServicesText] = useState("");
  const [bulkServicesError, setBulkServicesError] = useState<string | null>(null);
  const [showBulkProducts, setShowBulkProducts] = useState(false);
  const [bulkProductsText, setBulkProductsText] = useState("");
  const [bulkProductsError, setBulkProductsError] = useState<string | null>(null);
  const [servicePage, setServicePage] = useState(0);
  const [productPage, setProductPage] = useState(0);
  const [faqPage, setFaqPage] = useState(0);
  const [unknownFallback, setUnknownFallback] = useState(
    tenant.unknown_answer_fallback || ""
  );
  const [agentName, setAgentName] = useState(tenant.agent_name || "Receptionist");
  const [tone, setTone] = useState<OnboardingTone | "">(initialTone(tenant));
  const [hoursSchedule, setHoursSchedule] = useState<HoursSchedule>(() =>
    scheduleForForm(tenant.hours_schedule, tenant.business_hours || "")
  );
  const [locationNotes, setLocationNotes] = useState(
    () =>
      scheduleForForm(tenant.hours_schedule, "").location ||
      extractLocationFallback(tenant.business_hours || "")
  );
  const [afterHoursMode, setAfterHoursMode] = useState<AfterHoursMode>(() =>
    parseAfterHoursMode(tenant.after_hours_mode)
  );
  const [vertical, setVertical] = useState<BusinessVertical>(() =>
    parseVertical(tenant.vertical)
  );
  const [handoffMode, setHandoffMode] = useState<HandoffMode>(() =>
    parseHandoffMode(tenant.handoff_mode)
  );
  const [locations, setLocations] = useState<BusinessLocation[]>(() => {
    const rows = normalizeBusinessLocations(tenant.business_locations);
    if (rows.length) return rows;
    const fallback =
      scheduleForForm(tenant.hours_schedule, "").location ||
      extractLocationFallback(tenant.business_hours || "");
    return fallback
      ? [
          {
            label: "Main",
            address: fallback,
            landmark: "",
            directions: "",
            coverage_notes: "",
          },
        ]
      : [emptyLocation()];
  });
  const [policies, setPolicies] = useState<BusinessPolicies>(() =>
    normalizeBusinessPolicies(tenant.business_policies)
  );
  const [agentTools, setAgentTools] = useState<AgentTools>(() =>
    parseAgentTools(tenant.agent_tools)
  );
  const [sonioxVoiceId, setSonioxVoiceId] = useState(() =>
    initialSonioxVoiceId(tenant, voiceOptions)
  );
  const [sonioxVoiceLabel, setSonioxVoiceLabel] = useState(
    () => String(tenant.soniox_voice_label || "").trim()
  );
  const [voiceSampleLoading, setVoiceSampleLoading] = useState(false);
  const [voiceSampleError, setVoiceSampleError] = useState<string | null>(null);
  const [voiceSampleUrl, setVoiceSampleUrl] = useState<string | null>(null);
  const [team, setTeam] = useState<TeamDirectoryEntry[]>(() => {
    const rows = normalizeTeam(tenant.team_directory);
    return rows.length ? rows : [emptyMember()];
  });
  const [faqs, setFaqs] = useState<FaqEntry[]>(() => {
    const rows = normalizeFaqs(tenant.faqs);
    return rows.length ? rows : [emptyFaq()];
  });
  const [ttsLexicon, setTtsLexicon] = useState<TtsLexiconEntry[]>(() =>
    parseTtsLexicon(tenant.tts_lexicon)
  );
  const [state, formAction, pending] = useActionState(saveAndCompileSettings, initial);
  const [flash, setFlash] = useState<string | null>(null);

  const ttsLexiconJson = useMemo(
    () => JSON.stringify(lexiconForStorage(ttsLexicon)),
    [ttsLexicon]
  );

  const teamJson = useMemo(
    () =>
      JSON.stringify(
        team.filter((m) => m.name.trim() || m.role.trim() || m.phone.trim())
      ),
    [team]
  );
  const filledFaqCount = useMemo(
    () => faqs.filter((f) => f.question.trim() && f.answer.trim()).length,
    [faqs]
  );
  const faqsJson = useMemo(
    () =>
      JSON.stringify(
        faqs
          .filter((f) => f.question.trim() && f.answer.trim())
          .map((f) => ({
            question: f.question.trim().slice(0, FAQ_QUESTION_MAX),
            answer: f.answer.trim().slice(0, FAQ_ANSWER_MAX),
          }))
      ),
    [faqs]
  );
  const locationsJson = useMemo(
    () =>
      JSON.stringify(
        locations.filter(
          (loc) =>
            loc.label.trim() ||
            loc.address.trim() ||
            loc.landmark.trim() ||
            loc.directions.trim() ||
            loc.coverage_notes.trim()
        )
      ),
    [locations]
  );
  const policiesJson = useMemo(() => JSON.stringify(policies), [policies]);
  const faqDupIndexes = useMemo(() => {
    const seen = new Map<string, number>();
    const dups = new Set<number>();
    faqs.forEach((f, i) => {
      const key = normalizeFaqKey(f.question);
      if (!key) return;
      const prev = seen.get(key);
      if (prev != null) {
        dups.add(prev);
        dups.add(i);
      } else {
        seen.set(key, i);
      }
    });
    return dups;
  }, [faqs]);
  const servicesJson = useMemo(
    () => JSON.stringify(services.filter((s) => s.name.trim())),
    [services]
  );
  const productsJson = useMemo(
    () => JSON.stringify(products.filter((p) => p.name.trim())),
    [products]
  );
  const servicePageCount = Math.max(1, Math.ceil(services.length / SERVICE_PAGE_SIZE));
  const productPageCount = Math.max(1, Math.ceil(products.length / PRODUCT_PAGE_SIZE));
  const faqPageCount = Math.max(1, Math.ceil(faqs.length / FAQ_PAGE_SIZE));
  const safeServicePage = Math.min(servicePage, servicePageCount - 1);
  const safeProductPage = Math.min(productPage, productPageCount - 1);
  const safeFaqPage = Math.min(faqPage, faqPageCount - 1);
  const visibleServices = services.slice(
    safeServicePage * SERVICE_PAGE_SIZE,
    safeServicePage * SERVICE_PAGE_SIZE + SERVICE_PAGE_SIZE
  );
  const visibleProducts = products.slice(
    safeProductPage * PRODUCT_PAGE_SIZE,
    safeProductPage * PRODUCT_PAGE_SIZE + PRODUCT_PAGE_SIZE
  );
  const visibleFaqs = faqs.slice(
    safeFaqPage * FAQ_PAGE_SIZE,
    safeFaqPage * FAQ_PAGE_SIZE + FAQ_PAGE_SIZE
  );
  const socialJson = useMemo(
    () => JSON.stringify(socialHandles),
    [socialHandles]
  );
  const servicesOfferedSummary = useMemo(() => {
    const svc = formatServicesForCompiler(services, servicesNotes);
    const prod = formatProductsForCompiler(products);
    return [svc, prod].filter(Boolean).join("\n\n");
  }, [services, servicesNotes, products]);
  const hoursScheduleJson = useMemo(
    () =>
      JSON.stringify({
        ...hoursSchedule,
        location: locationNotes.trim(),
      }),
    [hoursSchedule, locationNotes]
  );
  const businessHoursSummary = useMemo(
    () =>
      formatHoursForCompiler({
        ...hoursSchedule,
        location: locationNotes.trim(),
      }),
    [hoursSchedule, locationNotes]
  );

  useEffect(() => {
    if (state.ok) {
      setFlash(
        state.source === "gemini"
          ? "Training complete. Your receptionist will use this on the next call."
          : "Training saved (basic mode). Your receptionist will use this on the next call."
      );
    }
  }, [state]);

  useEffect(() => {
    return () => {
      if (voiceSampleUrl) URL.revokeObjectURL(voiceSampleUrl);
    };
  }, [voiceSampleUrl]);

  async function playVoiceSample() {
    const sample =
      agentName && businessName
        ? `Hello, you've reached ${businessName}, this is ${agentName} speaking. How can I help?`
        : "Hello, how can I help you today?";
    setVoiceSampleLoading(true);
    setVoiceSampleError(null);
    if (voiceSampleUrl) {
      URL.revokeObjectURL(voiceSampleUrl);
      setVoiceSampleUrl(null);
    }
    try {
      const res = await fetch("/api/pronunciation/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: sample,
          lexicon: lexiconForStorage(ttsLexicon),
          voiceId: sonioxVoiceId || undefined,
        }),
      });
      if (!res.ok) {
        const errJson = await res.json().catch(() => null);
        throw new Error(
          errJson && typeof errJson.error === "string"
            ? errJson.error
            : `Preview failed (${res.status})`
        );
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      setVoiceSampleUrl(url);
      await new Audio(url).play();
    } catch (err) {
      setVoiceSampleError(
        err instanceof Error ? err.message : "Could not play voice sample."
      );
    } finally {
      setVoiceSampleLoading(false);
    }
  }

  function updateTeam(index: number, key: keyof TeamDirectoryEntry, value: string) {
    setTeam((prev) =>
      prev.map((row, i) => (i === index ? { ...row, [key]: value } : row))
    );
  }

  function updateFaq(index: number, key: keyof FaqEntry, value: string) {
    setFaqs((prev) =>
      prev.map((row, i) => (i === index ? { ...row, [key]: value } : row))
    );
  }

  function updateService(index: number, key: keyof ServiceItem, value: string) {
    setServices((prev) =>
      prev.map((row, i) => (i === index ? { ...row, [key]: value } : row))
    );
  }

  function updateProduct(index: number, key: keyof ProductItem, value: string) {
    setProducts((prev) =>
      prev.map((row, i) => {
        if (i !== index) return row;
        if (key === "aliases") {
          return {
            ...row,
            aliases: value
              .split(/[,;|]/)
              .map((a) => a.trim())
              .filter(Boolean)
              .slice(0, 8),
          };
        }
        return { ...row, [key]: value };
      })
    );
  }

  function updateSocialChannel(
    index: number,
    key: keyof SocialChannel,
    value: string
  ) {
    setSocialHandles((prev) => ({
      channels: prev.channels.map((row, i) =>
        i === index ? { ...row, [key]: value } : row
      ),
    }));
  }

  function addSocialChannel(kind = "phone") {
    setSocialHandles((prev) => {
      if (prev.channels.length >= SOCIAL_CHANNELS_MAX) return prev;
      const label =
        kind === "phone" || kind === "whatsapp"
          ? prev.channels.some((c) => c.kind === "phone" || c.kind === "whatsapp")
            ? "Sales"
            : "Main"
          : SOCIAL_CHANNEL_KINDS.find((k) => k.id === kind)?.label || "Other";
      return {
        channels: [...prev.channels, emptySocialChannel(kind, label)],
      };
    });
  }

  function removeSocialChannel(index: number) {
    setSocialHandles((prev) => ({
      channels: prev.channels.filter((_, i) => i !== index),
    }));
  }

  function updateLocation(
    index: number,
    key: keyof BusinessLocation,
    value: string
  ) {
    setLocations((prev) =>
      prev.map((row, i) => (i === index ? { ...row, [key]: value } : row))
    );
  }

  const bulkPreview = useMemo(
    () => parseBulkServices(bulkServicesText),
    [bulkServicesText]
  );
  const bulkProductPreview = useMemo(
    () => parseBulkProducts(bulkProductsText),
    [bulkProductsText]
  );

  function addBlankServiceRows(count: number) {
    setServices((prev) => [
      ...prev,
      ...Array.from({ length: count }, () => emptyService()),
    ]);
  }

  function applyBulkServices() {
    const parsed = parseBulkServices(bulkServicesText);
    if (!parsed.length) {
      setBulkServicesError(
        "Add at least one service name. Example: Same-day Nairobi delivery"
      );
      return;
    }
    setServices((prev) => {
      const existing = prev.filter((s) => s.name.trim());
      return [...existing, ...parsed].slice(0, 40);
    });
    setBulkServicesText("");
    setBulkServicesError(null);
    setShowBulkServices(false);
  }

  function applyBulkProducts() {
    const parsed = parseBulkProducts(bulkProductsText);
    if (!parsed.length) {
      setBulkProductsError(
        "Add at least one product. Example: Atomic Habits - 2,500 KES"
      );
      return;
    }
    setProducts((prev) => {
      const existing = prev.filter((p) => p.name.trim());
      const map = new Map(existing.map((p) => [p.name.toLowerCase(), p]));
      for (const p of parsed) {
        if (!map.has(p.name.toLowerCase())) map.set(p.name.toLowerCase(), p);
      }
      return [...map.values()].slice(0, PRODUCT_CATALOG_MAX);
    });
    setBulkProductsText("");
    setBulkProductsError(null);
    setShowBulkProducts(false);
  }

  function setDayOpen(day: DayKey, open: boolean) {
    setHoursSchedule((prev) => ({
      ...prev,
      days: {
        ...prev.days,
        [day]: open ? { open: "08:00", close: "18:00" } : null,
      },
    }));
  }

  function setDayTime(day: DayKey, key: "open" | "close", value: string) {
    setHoursSchedule((prev) => {
      const current = prev.days[day] || { open: "08:00", close: "18:00" };
      return {
        ...prev,
        days: {
          ...prev.days,
          [day]: { ...current, [key]: value },
        },
      };
    });
  }

  return (
    <form id={TENANT_SETTINGS_FORM_ID} action={formAction}>
      <header className={settingsStickyHeaderClass}>
        <div className="min-w-0">
          <h1 className="font-display text-2xl tracking-tight text-ink sm:text-3xl">
            Business
          </h1>
          {lineNumber ? (
            <p className="mt-0.5 text-sm text-ink-soft">
              Line <span className="font-medium text-ink">{lineNumber}</span>
            </p>
          ) : null}
        </div>
        <TenantSettingsSaveButton pending={pending} />
      </header>

      <div className="flex min-w-0 flex-col gap-4 lg:flex-row lg:items-start lg:gap-6">
        {sidebar}

        <div className="min-w-0 flex-1 space-y-4">
          {heading ? (
            <h2 className="font-display text-xl tracking-tight text-ink">{heading}</h2>
          ) : null}

      <input type="hidden" name="id" value={tenant.id} />
      <input type="hidden" name="business_name" value={businessName} />
      <input type="hidden" name="whatsapp_notification_number" value={ownerWhatsapp} />
      <input type="hidden" name="alert_email" value={alertEmail} />
      <input type="hidden" name="services_offered" value={servicesOfferedSummary} />
      <input type="hidden" name="services_catalog" value={servicesJson} />
      <input type="hidden" name="product_catalog" value={productsJson} />
      <input type="hidden" name="social_handles" value={socialJson} />
      <input type="hidden" name="services_notes" value={servicesNotes} />
      <input type="hidden" name="business_hours" value={businessHoursSummary} />
      <input type="hidden" name="hours_schedule" value={hoursScheduleJson} />
      <input type="hidden" name="location_notes" value={locationNotes} />
      <input type="hidden" name="after_hours_mode" value={afterHoursMode} />
      <input type="hidden" name="vertical" value={vertical} />
      <input type="hidden" name="handoff_mode" value={handoffMode} />
      <input type="hidden" name="business_locations" value={locationsJson} />
      <input type="hidden" name="business_policies" value={policiesJson} />
      <input type="hidden" name="agent_name" value={agentName} />
      <input type="hidden" name="agent_tone" value={tone} />
      <input type="hidden" name="unknown_answer_fallback" value={unknownFallback} />
      <input type="hidden" name="team_directory" value={teamJson} />
      <input type="hidden" name="faqs" value={faqsJson} />
      <input type="hidden" name="tool_escalate" value={agentTools.escalate ? "1" : "0"} />
      <input type="hidden" name="tool_end_call" value={agentTools.end_call ? "1" : "0"} />
      <input type="hidden" name="soniox_voice_id" value={sonioxVoiceId} />
      <input type="hidden" name="soniox_voice_label" value={sonioxVoiceLabel} />
      <input type="hidden" name="tts_lexicon" value={ttsLexiconJson} />

      <section className={panel === "identity" ? "space-y-4" : "hidden"}>
        <div>
          <p className="block text-sm font-medium">Business type</p>
          <div className="mt-2 flex flex-wrap gap-2" role="radiogroup" aria-label="Business type">
            {VERTICAL_OPTIONS.map((opt) => {
              const selected = vertical === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => setVertical(opt.id)}
                  className={choiceChipClass(selected)}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="block text-xs font-medium text-ink-soft" htmlFor="agent_name">
              Agent name
            </label>
            <input
              id="agent_name"
              value={agentName}
              onChange={(e) => setAgentName(e.target.value)}
              placeholder="e.g. Aisha"
              maxLength={40}
              className={`${denseFieldClass} mt-1`}
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-ink-soft" htmlFor="business_name">
              Business name
            </label>
            <input
              id="business_name"
              value={businessName}
              onChange={(e) => setBusinessName(e.target.value)}
              className={`${denseFieldClass} mt-1`}
            />
          </div>
        </div>

        <div>
          <p className="block text-sm font-medium">Tone</p>
          <div className="mt-2 flex flex-wrap gap-2" role="radiogroup" aria-label="Tone">
            {TONE_OPTIONS.map((opt) => {
              const selected = tone === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => setTone(opt.id)}
                  className={choiceChipClass(selected)}
                >
                  {TONE_LABELS[opt.id]}
                </button>
              );
            })}
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="block text-xs font-medium text-ink-soft" htmlFor="owner">
              Owner alert WhatsApp
            </label>
            <input
              id="owner"
              value={ownerWhatsapp}
              onChange={(e) => setOwnerWhatsapp(e.target.value)}
              placeholder="+2547…"
              className={`${denseFieldClass} mt-1`}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-ink-soft" htmlFor="alert_email">
              Alert email
            </label>
            <input
              id="alert_email"
              type="email"
              value={alertEmail}
              onChange={(e) => setAlertEmail(e.target.value)}
              placeholder="owner@business.com"
              className={`${denseFieldClass} mt-1`}
            />
          </div>
        </div>

        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-sm font-medium text-[var(--ink)]">Contacts</h3>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => addSocialChannel("phone")}
                className="rounded-lg border border-[#0096FF]/40 px-3 py-1.5 text-xs font-medium text-[#0096FF] hover:bg-[#0096FF]/10"
              >
                Add phone
              </button>
              <button
                type="button"
                onClick={() => addSocialChannel("whatsapp")}
                className="rounded-lg border border-[#0096FF]/40 px-3 py-1.5 text-xs font-medium text-[#0096FF] hover:bg-[#0096FF]/10"
              >
                Add WhatsApp
              </button>
              <button
                type="button"
                onClick={() => addSocialChannel("instagram")}
                className="rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-ink hover:border-[#0096FF]/40"
              >
                Add social
              </button>
            </div>
          </div>

          {socialHandles.channels.length === 0 ? (
            <p className="text-sm text-ink-soft">No contacts yet.</p>
          ) : (
            <>
            <div className="space-y-3 md:hidden">
              {socialHandles.channels.map((channel, index) => (
                <div
                  key={`social-m-${index}`}
                  className="space-y-2 rounded-xl border border-line bg-white p-3"
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-medium uppercase tracking-wide text-ink-soft">
                      Contact {index + 1}
                    </p>
                    <button
                      type="button"
                      onClick={() => removeSocialChannel(index)}
                      className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg text-ink-soft hover:bg-surface hover:text-warn"
                      aria-label={`Remove contact ${index + 1}`}
                    >
                      <TrashIcon className="h-4 w-4" />
                    </button>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-ink-soft" htmlFor={`social-kind-m-${index}`}>Type</label>
                    <select
                      id={`social-kind-m-${index}`}
                      value={channel.kind}
                      onChange={(e) => updateSocialChannel(index, "kind", e.target.value)}
                      className={`${denseFieldClass} mt-1`}
                    >
                      {SOCIAL_CHANNEL_KINDS.map((k) => (
                        <option key={k.id} value={k.id}>{k.label}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-ink-soft" htmlFor={`social-label-m-${index}`}>Label</label>
                    <input
                      id={`social-label-m-${index}`}
                      value={channel.label}
                      onChange={(e) => updateSocialChannel(index, "label", e.target.value)}
                      placeholder="Main"
                      className={`${denseFieldClass} mt-1`}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-ink-soft" htmlFor={`social-value-m-${index}`}>Handle / URL</label>
                    <input
                      id={`social-value-m-${index}`}
                      value={channel.value}
                      onChange={(e) => updateSocialChannel(index, "value", e.target.value)}
                      placeholder={SOCIAL_CHANNEL_KINDS.find((k) => k.id === channel.kind)?.placeholder || ""}
                      className={`${denseFieldClass} mt-1 [overflow-wrap:anywhere]`}
                    />
                  </div>
                </div>
              ))}
            </div>
            <div className="hidden overflow-hidden rounded-xl border border-line md:block">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[520px] text-sm">
                  <thead>
                    <tr className="border-b border-line bg-surface-canvas text-left text-xs font-medium uppercase tracking-wide text-ink-soft">
                      <th className="px-3 py-2 font-medium w-36">Type</th>
                      <th className="px-3 py-2 font-medium w-28">Label</th>
                      <th className="px-3 py-2 font-medium">Handle / URL</th>
                      <th className="px-3 py-2 font-medium w-12">
                        <span className="sr-only">Action</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line bg-white">
                    {socialHandles.channels.map((channel, index) => (
                      <tr key={`social-ch-${index}`} className="align-middle">
                        <td className="px-3 py-1.5">
                          <label className="sr-only" htmlFor={`social-kind-${index}`}>
                            Type
                          </label>
                          <select
                            id={`social-kind-${index}`}
                            value={channel.kind}
                            onChange={(e) =>
                              updateSocialChannel(index, "kind", e.target.value)
                            }
                            className={denseFieldClass}
                          >
                            {SOCIAL_CHANNEL_KINDS.map((k) => (
                              <option key={k.id} value={k.id}>
                                {k.label}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="px-3 py-1.5">
                          <label className="sr-only" htmlFor={`social-label-${index}`}>
                            Label
                          </label>
                          <input
                            id={`social-label-${index}`}
                            value={channel.label}
                            onChange={(e) =>
                              updateSocialChannel(index, "label", e.target.value)
                            }
                            placeholder="Main"
                            className={denseFieldClass}
                          />
                        </td>
                        <td className="px-3 py-1.5">
                          <label className="sr-only" htmlFor={`social-value-${index}`}>
                            Handle / URL
                          </label>
                          <input
                            id={`social-value-${index}`}
                            value={channel.value}
                            onChange={(e) =>
                              updateSocialChannel(index, "value", e.target.value)
                            }
                            placeholder={
                              SOCIAL_CHANNEL_KINDS.find((k) => k.id === channel.kind)
                                ?.placeholder || ""
                            }
                            className={denseFieldClass}
                          />
                        </td>
                        <td className="px-2 py-1.5">
                          <button
                            type="button"
                            onClick={() => removeSocialChannel(index)}
                            className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-ink-soft transition hover:bg-surface hover:text-warn"
                            aria-label={`Remove contact ${index + 1}`}
                          >
                            <TrashIcon className="h-4 w-4" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            </>
          )}
        </div>
      </section>

      <section className={panel === "catalog" ? "space-y-4" : "hidden"}>
        <div className="space-y-3">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <h3 className="text-sm font-medium text-[var(--ink)]">Services</h3>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => {
                  setServices((prev) => [...prev, emptyService()]);
                  setServicePage(Math.floor(services.length / SERVICE_PAGE_SIZE));
                }}
                className="rounded-lg border border-[var(--accent)]/40 px-3 py-1.5 text-xs font-medium text-[var(--accent)] hover:bg-[var(--accent-soft)]"
              >
                Add 1
              </button>
              <button
                type="button"
                onClick={() => addBlankServiceRows(3)}
                className="rounded-lg border border-[var(--accent)]/40 px-3 py-1.5 text-xs font-medium text-[var(--accent)] hover:bg-[var(--accent-soft)]"
              >
                Add 3 blank
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowBulkServices((v) => !v);
                  setBulkServicesError(null);
                }}
                className="rounded-lg border border-[var(--line)] px-3 py-1.5 text-xs font-medium text-[var(--ink)] hover:border-[var(--accent)]/50"
              >
                {showBulkServices ? "Hide paste" : "Paste list"}
              </button>
            </div>
          </div>

          {showBulkServices ? (
            <div className="space-y-3 rounded-xl border border-[var(--line)] bg-[var(--accent-soft)]/40 p-3">
              <label className="block text-sm font-medium" htmlFor="bulk_services">
                Paste list
              </label>
              <textarea
                id="bulk_services"
                value={bulkServicesText}
                onChange={(e) => {
                  setBulkServicesText(e.target.value);
                  if (bulkServicesError) setBulkServicesError(null);
                }}
                rows={4}
                placeholder={
                  "Home cleaning - from 2,500 KES\nPlumbing\nElectrical - quote after visit"
                }
                className={`${denseFieldClass} text-sm leading-relaxed`}
              />
              <details className="text-xs text-[var(--ink-soft)]">
                <summary className="cursor-pointer font-medium text-[var(--ink)]">
                  Spreadsheet format
                </summary>
                <p className="mt-2 leading-relaxed">
                  Columns:{" "}
                  <span className="font-medium text-[var(--ink)]">
                    name | price | notes | out of scope
                  </span>
                </p>
              </details>

              {bulkPreview.length > 0 ? (
                <div className="rounded-xl border border-[var(--line)] bg-white px-3 py-2">
                  <p className="text-xs font-medium text-[var(--ink)]">
                    Ready to add {bulkPreview.length} service
                    {bulkPreview.length === 1 ? "" : "s"}
                  </p>
                  <ul className="mt-2 space-y-1 text-sm text-[var(--ink-soft)]">
                    {bulkPreview.slice(0, 8).map((row, i) => (
                      <li key={`${row.name}-${i}`}>
                        <span className="font-medium text-[var(--ink)]">{row.name}</span>
                        {row.price_range ? ` · ${row.price_range}` : ""}
                      </li>
                    ))}
                    {bulkPreview.length > 8 ? (
                      <li>+{bulkPreview.length - 8} more</li>
                    ) : null}
                  </ul>
                </div>
              ) : null}

              {bulkServicesError ? (
                <p className="text-sm text-[var(--warn)]" role="alert">
                  {bulkServicesError}
                </p>
              ) : null}
              <button
                type="button"
                onClick={applyBulkServices}
                disabled={!bulkPreview.length}
                className="rounded-xl bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--accent-deep)] disabled:opacity-50"
              >
                Add to services
              </button>
            </div>
          ) : null}

          <div className="space-y-3 md:hidden">
            {visibleServices.map((service, localIndex) => {
              const index = safeServicePage * SERVICE_PAGE_SIZE + localIndex;
              return (
                <div key={`service-m-${index}`} className="space-y-2 rounded-xl border border-line bg-white p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-medium uppercase tracking-wide text-ink-soft">Service {index + 1}</p>
                    <button
                      type="button"
                      onClick={() =>
                        setServices((prev) =>
                          prev.length <= 1 ? [emptyService()] : prev.filter((_, i) => i !== index)
                        )
                      }
                      className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg text-ink-soft hover:bg-surface hover:text-warn"
                      aria-label={`Remove service ${index + 1}`}
                    >
                      <TrashIcon className="h-4 w-4" />
                    </button>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-ink-soft" htmlFor={`svc-name-m-${index}`}>Name</label>
                    <input id={`svc-name-m-${index}`} value={service.name} onChange={(e) => updateService(index, "name", e.target.value)} placeholder={vertical === "retail" ? "Book sourcing / special orders" : "Home cleaning"} className={`${denseFieldClass} mt-1`} />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-ink-soft" htmlFor={`svc-price-m-${index}`}>Price</label>
                    <input id={`svc-price-m-${index}`} value={service.price_range} onChange={(e) => updateService(index, "price_range", e.target.value)} placeholder="from 2,500 KES" className={`${denseFieldClass} mt-1`} />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-ink-soft" htmlFor={`svc-notes-m-${index}`}>Notes</label>
                    <input id={`svc-notes-m-${index}`} value={service.notes} onChange={(e) => updateService(index, "notes", e.target.value)} placeholder="Free quotation" className={`${denseFieldClass} mt-1`} />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-ink-soft" htmlFor={`svc-oos-m-${index}`}>Out of scope</label>
                    <input id={`svc-oos-m-${index}`} value={service.out_of_scope} onChange={(e) => updateService(index, "out_of_scope", e.target.value)} placeholder="No commercial offices" className={`${denseFieldClass} mt-1`} />
                  </div>
                </div>
              );
            })}
            <CatalogPager
              page={safeServicePage}
              pageSize={SERVICE_PAGE_SIZE}
              total={services.length}
              noun="service"
              onPrev={() => setServicePage((p) => Math.max(0, p - 1))}
              onNext={() => setServicePage((p) => Math.min(servicePageCount - 1, p + 1))}
            />
          </div>

          <div className="hidden overflow-hidden rounded-xl border border-line md:block">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-sm">
                <thead>
                  <tr className="border-b border-line bg-surface-canvas text-left text-xs font-medium uppercase tracking-wide text-ink-soft">
                    <th className="px-3 py-2.5 font-medium">Name</th>
                    <th className="px-3 py-2.5 font-medium">Price</th>
                    <th className="px-3 py-2.5 font-medium">Notes</th>
                    <th className="px-3 py-2.5 font-medium">Out of scope</th>
                    <th className="px-3 py-2.5 font-medium w-16">
                      <span className="sr-only">Action</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line bg-white">
                  {visibleServices.map((service, localIndex) => {
                    const index = safeServicePage * SERVICE_PAGE_SIZE + localIndex;
                    return (
                      <tr key={`service-${index}`} className="align-middle">
                        <td className="px-3 py-2">
                          <label className="sr-only" htmlFor={`svc-name-${index}`}>
                            Service name
                          </label>
                          <input
                            id={`svc-name-${index}`}
                            value={service.name}
                            onChange={(e) => updateService(index, "name", e.target.value)}
                            placeholder={
                              vertical === "retail"
                                ? "Book sourcing / special orders"
                                : "Home cleaning"
                            }
                            className={tableFieldClass}
                          />
                        </td>
                        <td className="px-3 py-2">
                          <label className="sr-only" htmlFor={`svc-price-${index}`}>
                            Price range
                          </label>
                          <input
                            id={`svc-price-${index}`}
                            value={service.price_range}
                            onChange={(e) =>
                              updateService(index, "price_range", e.target.value)
                            }
                            placeholder="from 2,500 KES"
                            className={tableFieldClass}
                          />
                        </td>
                        <td className="px-3 py-2">
                          <label className="sr-only" htmlFor={`svc-notes-${index}`}>
                            Notes
                          </label>
                          <input
                            id={`svc-notes-${index}`}
                            value={service.notes}
                            onChange={(e) => updateService(index, "notes", e.target.value)}
                            placeholder="Free quotation"
                            className={tableFieldClass}
                          />
                        </td>
                        <td className="px-3 py-2">
                          <label className="sr-only" htmlFor={`svc-oos-${index}`}>
                            Out of scope
                          </label>
                          <input
                            id={`svc-oos-${index}`}
                            value={service.out_of_scope}
                            onChange={(e) =>
                              updateService(index, "out_of_scope", e.target.value)
                            }
                            placeholder="No commercial offices"
                            className={tableFieldClass}
                          />
                        </td>
                        <td className="px-2 py-2">
                          <button
                            type="button"
                            onClick={() =>
                              setServices((prev) =>
                                prev.length <= 1
                                  ? [emptyService()]
                                  : prev.filter((_, i) => i !== index)
                              )
                            }
                            className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-ink-soft transition hover:bg-surface hover:text-warn"
                            aria-label={`Remove service ${index + 1}`}
                          >
                            <TrashIcon className="h-4 w-4" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <CatalogPager
              page={safeServicePage}
              pageSize={SERVICE_PAGE_SIZE}
              total={services.length}
              noun="service"
              onPrev={() => setServicePage((p) => Math.max(0, p - 1))}
              onNext={() => setServicePage((p) => Math.min(servicePageCount - 1, p + 1))}
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-ink-soft" htmlFor="services_notes">
              Notes
            </label>
            <textarea
              id="services_notes"
              value={servicesNotes}
              onChange={(e) => setServicesNotes(e.target.value)}
              rows={2}
              placeholder="Coverage, lead times, exclusions"
              className={`${denseFieldClass} mt-1 leading-relaxed`}
            />
          </div>
        </div>

        <div className="space-y-3">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <h3 className="text-sm font-medium text-[var(--ink)]">Products</h3>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => {
                  setProducts((prev) => [...prev, emptyProduct()]);
                  setProductPage(Math.floor(products.length / PRODUCT_PAGE_SIZE));
                }}
                className="rounded-lg border border-[var(--accent)]/40 px-3 py-1.5 text-xs font-medium text-[var(--accent)] hover:bg-[var(--accent-soft)]"
              >
                Add product
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowBulkProducts((v) => !v);
                  setBulkProductsError(null);
                }}
                className="rounded-lg border border-[var(--line)] px-3 py-1.5 text-xs font-medium text-[var(--ink)]"
              >
                {showBulkProducts ? "Hide paste" : "Paste products"}
              </button>
            </div>
          </div>

          {showBulkProducts ? (
            <div className="space-y-3 rounded-xl border border-[var(--line)] bg-[var(--accent-soft)]/40 p-3">
              <textarea
                value={bulkProductsText}
                onChange={(e) => {
                  setBulkProductsText(e.target.value);
                  if (bulkProductsError) setBulkProductsError(null);
                }}
                rows={4}
                placeholder={
                  "name,price,category,in_stock\nAtomic Habits,2500 KES,Self-help,yes\n\nOr:\nAtomic Habits - 2,500 KES"
                }
                className={`${denseFieldClass} text-sm leading-relaxed`}
              />
              {bulkProductPreview.length ? (
                <p className="text-xs text-[var(--ink-soft)]">
                  Ready to add {bulkProductPreview.length} product
                  {bulkProductPreview.length === 1 ? "" : "s"}
                </p>
              ) : null}
              {bulkProductsError ? (
                <p className="text-sm text-[var(--warn)]">{bulkProductsError}</p>
              ) : null}
              <button
                type="button"
                onClick={applyBulkProducts}
                disabled={!bulkProductPreview.length}
                className="rounded-xl bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
              >
                Add to catalogue
              </button>
            </div>
          ) : null}

          {products.length === 0 ? (
            <p className="text-sm text-[var(--ink-soft)]">No products yet.</p>
          ) : (
            <>
            <div className="space-y-3 md:hidden">
              {visibleProducts.map((product, localIndex) => {
                const index = safeProductPage * PRODUCT_PAGE_SIZE + localIndex;
                return (
                  <div key={`product-m-${index}`} className="space-y-2 rounded-xl border border-line bg-white p-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs font-medium uppercase tracking-wide text-ink-soft">Product {index + 1}</p>
                      <button type="button" onClick={() => setProducts((prev) => prev.filter((_, i) => i !== index))} className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg text-ink-soft hover:text-warn" aria-label={`Remove product ${index + 1}`}>
                        <TrashIcon className="h-4 w-4" />
                      </button>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-ink-soft" htmlFor={`prod-name-m-${index}`}>Name</label>
                      <input id={`prod-name-m-${index}`} value={product.name} onChange={(e) => updateProduct(index, "name", e.target.value)} placeholder="Atomic Habits" className={`${denseFieldClass} mt-1`} />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-ink-soft" htmlFor={`prod-price-m-${index}`}>Price</label>
                      <input id={`prod-price-m-${index}`} value={product.price} onChange={(e) => updateProduct(index, "price", e.target.value)} placeholder="2,500 KES" className={`${denseFieldClass} mt-1`} />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-ink-soft" htmlFor={`prod-cat-m-${index}`}>Category</label>
                      <input id={`prod-cat-m-${index}`} value={product.category} onChange={(e) => updateProduct(index, "category", e.target.value)} placeholder="Self-help" className={`${denseFieldClass} mt-1`} />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-ink-soft" htmlFor={`prod-stock-m-${index}`}>Stock</label>
                      <select id={`prod-stock-m-${index}`} value={product.in_stock || ""} onChange={(e) => updateProduct(index, "in_stock", e.target.value)} className={`${denseFieldClass} mt-1`}>
                        <option value="">Not set</option>
                        <option value="yes">In stock</option>
                        <option value="no">Out of stock</option>
                        <option value="unknown">Unknown</option>
                      </select>
                    </div>
                  </div>
                );
              })}
              <CatalogPager
                page={safeProductPage}
                pageSize={PRODUCT_PAGE_SIZE}
                total={products.length}
                noun="product"
                onPrev={() => setProductPage((p) => Math.max(0, p - 1))}
                onNext={() => setProductPage((p) => Math.min(productPageCount - 1, p + 1))}
              />
            </div>
            <div className="hidden overflow-hidden rounded-xl border border-line md:block">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-sm">
                  <thead>
                    <tr className="border-b border-line bg-surface-canvas text-left text-xs font-medium uppercase tracking-wide text-ink-soft">
                      <th className="px-3 py-2.5 font-medium">Name</th>
                      <th className="px-3 py-2.5 font-medium">Price</th>
                      <th className="px-3 py-2.5 font-medium">Category</th>
                      <th className="px-3 py-2.5 font-medium">Stock</th>
                      <th className="px-3 py-2.5 font-medium w-24">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line bg-white">
                    {visibleProducts.map((product, localIndex) => {
                      const index = safeProductPage * PRODUCT_PAGE_SIZE + localIndex;
                      return (
                        <tr key={`product-${index}`} className="align-middle">
                          <td className="px-3 py-2">
                            <label className="sr-only" htmlFor={`prod-name-${index}`}>
                              Product name
                            </label>
                            <input
                              id={`prod-name-${index}`}
                              value={product.name}
                              onChange={(e) => updateProduct(index, "name", e.target.value)}
                              placeholder="Atomic Habits"
                              className={tableFieldClass}
                            />
                          </td>
                          <td className="px-3 py-2">
                            <label className="sr-only" htmlFor={`prod-price-${index}`}>
                              Price
                            </label>
                            <input
                              id={`prod-price-${index}`}
                              value={product.price}
                              onChange={(e) => updateProduct(index, "price", e.target.value)}
                              placeholder="2,500 KES"
                              className={tableFieldClass}
                            />
                          </td>
                          <td className="px-3 py-2">
                            <label className="sr-only" htmlFor={`prod-cat-${index}`}>
                              Category
                            </label>
                            <input
                              id={`prod-cat-${index}`}
                              value={product.category}
                              onChange={(e) => updateProduct(index, "category", e.target.value)}
                              placeholder="Self-help"
                              className={tableFieldClass}
                            />
                          </td>
                          <td className="px-3 py-2">
                            <label className="sr-only" htmlFor={`prod-stock-${index}`}>
                              Stock status
                            </label>
                            <select
                              id={`prod-stock-${index}`}
                              value={product.in_stock || ""}
                              onChange={(e) => updateProduct(index, "in_stock", e.target.value)}
                              className={tableFieldClass}
                            >
                              <option value="">Not set</option>
                              <option value="yes">In stock</option>
                              <option value="no">Out of stock</option>
                              <option value="unknown">Unknown</option>
                            </select>
                          </td>
                          <td className="px-3 py-2">
                            <button
                              type="button"
                              onClick={() =>
                                setProducts((prev) => prev.filter((_, i) => i !== index))
                              }
                              className="text-sm font-medium text-ink-soft hover:text-warn"
                            >
                              Remove
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <CatalogPager
                page={safeProductPage}
                pageSize={PRODUCT_PAGE_SIZE}
                total={products.length}
                noun="product"
                onPrev={() => setProductPage((p) => Math.max(0, p - 1))}
                onNext={() => setProductPage((p) => Math.min(productPageCount - 1, p + 1))}
              />
            </div>
            </>
          )}
        </div>
      </section>

      <section className={panel === "hours" ? "space-y-3" : "hidden"}>
        <div className="space-y-3">
          <div className="space-y-1.5">
            {DAY_ORDER.map((day) => {
              const slot = hoursSchedule.days[day];
              const open = Boolean(slot);
              return (
                <div
                  key={day}
                  className="flex min-w-0 flex-col gap-2 rounded-lg border border-line/70 bg-white/60 px-3 py-2.5 sm:grid sm:grid-cols-[8.5rem_auto_1fr_1fr] sm:items-center sm:gap-3 sm:border-0 sm:bg-transparent sm:px-0 sm:py-0"
                >
                  <span className="text-sm font-medium text-[var(--ink)]">
                    {DAY_LABELS[day]}
                  </span>
                  <button
                    type="button"
                    onClick={() => setDayOpen(day, !open)}
                    className={[
                      "inline-flex min-h-11 w-fit items-center rounded-lg border px-3 text-xs font-medium transition",
                      open
                        ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]"
                        : "border-[var(--line)] text-[var(--ink-soft)]",
                    ].join(" ")}
                  >
                    {open ? "Open" : "Closed"}
                  </button>
                  {open && slot ? (
                    <div className="flex min-w-0 flex-wrap items-center gap-2 sm:col-span-2">
                      <label className="sr-only" htmlFor={`open-${day}`}>
                        Opens
                      </label>
                      <input
                        id={`open-${day}`}
                        type="time"
                        value={slot.open}
                        onChange={(e) => setDayTime(day, "open", e.target.value)}
                        className="min-h-11 min-w-0 max-w-full flex-1 rounded-lg border border-line bg-white px-2 py-1.5 text-sm outline-none focus:border-[#0096FF] focus:ring-2 focus:ring-[#0096FF]/40"
                      />
                      <span className="text-xs text-[var(--ink-soft)]">to</span>
                      <label className="sr-only" htmlFor={`close-${day}`}>
                        Closes
                      </label>
                      <input
                        id={`close-${day}`}
                        type="time"
                        value={slot.close}
                        onChange={(e) => setDayTime(day, "close", e.target.value)}
                        className="min-h-11 min-w-0 max-w-full flex-1 rounded-lg border border-line bg-white px-2 py-1.5 text-sm outline-none focus:border-[#0096FF] focus:ring-2 focus:ring-[#0096FF]/40"
                      />
                    </div>
                  ) : (
                    <span className="text-xs text-[var(--ink-soft)] sm:col-span-2">
                      Closed all day
                    </span>
                  )}
                </div>
              );
            })}
          </div>

          <div>
            <p className="block text-sm font-medium">After hours</p>
            <div className="mt-2 flex flex-wrap gap-2" role="radiogroup" aria-label="After hours">
              {AFTER_HOURS_OPTIONS.map((opt) => {
                const selected = afterHoursMode === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => setAfterHoursMode(opt.id)}
                    className={choiceChipClass(selected)}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </section>

      <section
        className={panel === "locations" ? "space-y-3" : "hidden"}
      >
        <div className="flex flex-wrap items-end justify-between gap-3">
          <p className="text-xs text-ink-soft">
            {locations.length} of {LOCATIONS_MAX}
          </p>
          <button
            type="button"
            disabled={locations.length >= LOCATIONS_MAX}
            onClick={() =>
              setLocations((prev) =>
                prev.length >= LOCATIONS_MAX ? prev : [...prev, emptyLocation()]
              )
            }
            className="rounded-lg border border-[var(--accent)]/40 px-3 py-1.5 text-xs font-medium text-[var(--accent)] hover:bg-[var(--accent-soft)] disabled:opacity-50"
          >
            Add location
          </button>
        </div>
        <div className="space-y-2">
          {locations.map((loc, index) => (
            <div
              key={`loc-${index}`}
              className="space-y-2 rounded-xl border border-[var(--line)] bg-white/60 p-3"
            >
              <div className="grid gap-2 sm:grid-cols-2">
                <div>
                  <label
                    className="block text-xs font-medium text-[var(--ink-soft)]"
                    htmlFor={`loc-label-${index}`}
                  >
                    Label
                  </label>
                  <input
                    id={`loc-label-${index}`}
                    value={loc.label}
                    onChange={(e) => {
                      updateLocation(index, "label", e.target.value);
                      if (index === 0) {
                        setLocationNotes(
                          [e.target.value, loc.address, loc.landmark]
                            .map((s) => s.trim())
                            .filter(Boolean)
                            .join(" · ") || locationNotes
                        );
                      }
                    }}
                    placeholder="Main shop"
                    className={`${denseFieldClass} mt-1`}
                  />
                </div>
                <div>
                  <label
                    className="block text-xs font-medium text-[var(--ink-soft)]"
                    htmlFor={`loc-landmark-${index}`}
                  >
                    Landmark
                  </label>
                  <input
                    id={`loc-landmark-${index}`}
                    value={loc.landmark}
                    onChange={(e) => {
                      updateLocation(index, "landmark", e.target.value);
                      if (index === 0) {
                        const next = {
                          ...loc,
                          landmark: e.target.value,
                        };
                        setLocationNotes(
                          [next.label, next.address, next.landmark]
                            .map((s) => s.trim())
                            .filter(Boolean)
                            .join(" · ")
                        );
                      }
                    }}
                    placeholder="Opposite Naivas, next to…"
                    className={`${denseFieldClass} mt-1`}
                  />
                </div>
              </div>
              <div>
                <label
                  className="block text-xs font-medium text-[var(--ink-soft)]"
                  htmlFor={`loc-address-${index}`}
                >
                  Address / area
                </label>
                <input
                  id={`loc-address-${index}`}
                  value={loc.address}
                  onChange={(e) => {
                    updateLocation(index, "address", e.target.value);
                    if (index === 0) {
                      const next = { ...loc, address: e.target.value };
                      setLocationNotes(
                        [next.label, next.address, next.landmark]
                          .map((s) => s.trim())
                          .filter(Boolean)
                          .join(" · ")
                      );
                    }
                  }}
                  placeholder="Westlands, Nairobi"
                  className={`${denseFieldClass} mt-1`}
                />
              </div>
              <div>
                <label
                  className="block text-xs font-medium text-[var(--ink-soft)]"
                  htmlFor={`loc-directions-${index}`}
                >
                  Directions (spoken)
                </label>
                <textarea
                  id={`loc-directions-${index}`}
                  value={loc.directions}
                  onChange={(e) => updateLocation(index, "directions", e.target.value)}
                  rows={2}
                  placeholder="From Waiyaki Way, turn at the Shell. We are on the left."
                  className={`${denseFieldClass} mt-1 leading-relaxed`}
                />
              </div>
              <div>
                <label
                  className="block text-xs font-medium text-[var(--ink-soft)]"
                  htmlFor={`loc-coverage-${index}`}
                >
                  Coverage notes
                </label>
                <input
                  id={`loc-coverage-${index}`}
                  value={loc.coverage_notes}
                  onChange={(e) =>
                    updateLocation(index, "coverage_notes", e.target.value)
                  }
                  placeholder="We also cover Kiambu and Ruiru"
                  className={`${denseFieldClass} mt-1`}
                />
              </div>
              {locations.length > 1 ? (
                <button
                  type="button"
                  onClick={() =>
                    setLocations((prev) => prev.filter((_, i) => i !== index))
                  }
                  className="text-xs text-[var(--warn)] hover:underline"
                >
                  Remove location
                </button>
              ) : null}
            </div>
          ))}
        </div>
      </section>

      <section
        className={panel === "policies" ? "space-y-3" : "hidden"}
      >
        <div className="space-y-2">
          <div className="grid gap-2 sm:grid-cols-2">
            {POLICY_FIELDS.map((field) => (
              <div key={field.id} className={field.id === "other" ? "sm:col-span-2" : ""}>
                <label
                  className="block text-xs font-medium text-ink-soft"
                  htmlFor={`policy-${field.id}`}
                >
                  {field.label}
                </label>
                <PolicyTextarea
                  id={`policy-${field.id}`}
                  value={policies[field.id]}
                  onChange={(value) =>
                    setPolicies((prev) => ({ ...prev, [field.id]: value }))
                  }
                  placeholder={field.placeholder}
                />
              </div>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium" htmlFor="unknown_answer_fallback">
            Unknown fallback
          </label>
          <PolicyTextarea
            id="unknown_answer_fallback"
            value={unknownFallback}
            onChange={setUnknownFallback}
            placeholder="Team will call you back today."
          />
        </div>
      </section>

            <section className={panel === "tools" ? "space-y-4" : "hidden"}>
        <div className="space-y-2">
          <div>
            <p className="text-sm font-medium text-[var(--ink)]">Phone voice</p>
            <p className="mt-0.5 text-xs text-[var(--ink-soft)]">
              Call sound. Save &amp; train after changing.
            </p>
          </div>
          {voiceOptions.length > 1 ? (
            <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Phone voice profile">
              {voiceOptions.map((voice, index) => {
                const selected = sonioxVoiceId === voice.id;
                return (
                  <button
                    key={voice.id}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    title={voice.description || undefined}
                    onClick={() => setSonioxVoiceId(voice.id)}
                    className={choiceChipClass(selected)}
                  >
                    Voice option {index + 1}
                  </button>
                );
              })}
            </div>
          ) : voiceOptions[0]?.description ? (
            <p className="text-sm text-[var(--ink-soft)]">{voiceOptions[0].description}</p>
          ) : (
            <p className="text-sm text-[var(--ink-soft)]">
              No platform voices loaded yet. Super Admin can add them under Voices.
            </p>
          )}
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-[12rem] flex-1">
              <label className="block text-xs font-medium text-ink-soft" htmlFor="soniox_voice_label">
                Voice label
              </label>
              <input
                id="soniox_voice_label"
                type="text"
                maxLength={40}
                value={sonioxVoiceLabel}
                onChange={(e) => setSonioxVoiceLabel(e.target.value)}
                placeholder="Front desk voice"
                className={`${denseFieldClass} mt-1`}
              />
            </div>
            <button
              type="button"
              onClick={() => void playVoiceSample()}
              disabled={voiceSampleLoading}
              className="rounded-lg border border-[var(--line)] bg-white px-3 py-2 text-xs font-medium text-[var(--ink)] hover:border-[var(--accent)] disabled:opacity-60"
            >
              {voiceSampleLoading ? "Generating…" : "Hear sample"}
            </button>
          </div>
          {voiceSampleUrl ? (
            <audio src={voiceSampleUrl} controls className="max-w-full" />
          ) : null}
          {voiceSampleError ? (
            <p className="text-xs text-[var(--warn)]" role="alert">
              {voiceSampleError}
            </p>
          ) : null}
          {sonioxVoiceLabel.trim() || sonioxVoiceId ? (
            <p className="text-xs text-[var(--ink-soft)]">
              Selected:{" "}
              <span className="font-medium text-[var(--ink)]">
                {displaySonioxVoiceLabel(
                  sonioxVoiceLabel,
                  sonioxVoiceId,
                  voiceOptions
                )}
              </span>
            </p>
          ) : null}
        </div>
        <div className="space-y-2">
          <p className="text-sm font-medium text-[var(--ink)]">Handoff</p>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Handoff mode">
            {HANDOFF_OPTIONS.map((opt) => {
              const selected = handoffMode === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  title={opt.blurb}
                  onClick={() => setHandoffMode(opt.id)}
                  className={choiceChipClass(selected)}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        </div>
        <div className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-white">
          {AGENT_TOOL_OPTIONS.map((opt) => {
            const on = agentTools[opt.id];
            return (
              <div
                key={opt.id}
                className="flex items-center justify-between gap-4 px-3 py-2.5"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-[var(--ink)]">{opt.label}</p>
                  <p className="mt-0.5 text-xs text-[var(--ink-soft)]">
                    {on ? opt.onLabel : opt.offLabel}
                  </p>
                </div>
                <ToolSwitch
                  checked={on}
                  label={opt.label}
                  onChange={(next) =>
                    setAgentTools((prev) => ({
                      ...prev,
                      [opt.id]: next,
                    }))
                  }
                />
              </div>
            );
          })}
        </div>
      </section>

<section
        className={panel === "pronunciation" ? "space-y-4" : "hidden"}
      >
        {panel === "pronunciation" ? (
          <PronunciationCoach
            tenantId={tenant.id}
            businessName={businessName}
            agentName={agentName}
            sonioxVoiceId={sonioxVoiceId}
            locationNotes={locationNotes}
            locations={locations}
            team={team}
            services={services}
            faqs={faqs}
            bulletinTexts={
              Array.isArray(tenant.daily_bulletin)
                ? tenant.daily_bulletin
                    .map((b) => String(b?.text || "").trim())
                    .filter(Boolean)
                : []
            }
            initialLexicon={ttsLexicon}
            onLexiconChange={setTtsLexicon}
            omitLexiconField
          />
        ) : null}
      </section>

      <section className={panel === "team" ? "space-y-4" : "hidden"}>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <p className="text-xs text-ink-soft">{team.length} teammate{team.length === 1 ? "" : "s"}</p>
          <button
            type="button"
            onClick={() => setTeam((prev) => [...prev, emptyMember()])}
            className="rounded-lg border border-[var(--accent)]/40 px-3 py-1.5 text-xs font-medium text-[var(--accent)] hover:bg-[var(--accent-soft)]"
          >
            Add teammate
          </button>
        </div>

        <div className="space-y-2">
          {team.map((member, index) => (
            <div key={`team-${index}`} className="grid gap-2 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1fr_1fr_auto] sm:items-end">
              <div>
                <label className="block text-xs font-medium text-[var(--ink-soft)]" htmlFor={`team-name-${index}`}>
                  Name
                </label>
                <input
                  id={`team-name-${index}`}
                  value={member.name}
                  onChange={(e) => updateTeam(index, "name", e.target.value)}
                  placeholder="Jane Doe"
                  className={`${denseFieldClass} mt-1`}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[var(--ink-soft)]" htmlFor={`team-role-${index}`}>
                  Role
                </label>
                <input
                  id={`team-role-${index}`}
                  value={member.role}
                  onChange={(e) => updateTeam(index, "role", e.target.value)}
                  placeholder="General queries"
                  className={`${denseFieldClass} mt-1`}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[var(--ink-soft)]" htmlFor={`team-phone-${index}`}>
                  Phone / WhatsApp
                </label>
                <input
                  id={`team-phone-${index}`}
                  value={member.phone}
                  onChange={(e) => updateTeam(index, "phone", e.target.value)}
                  placeholder="+2547…"
                  className={`${denseFieldClass} mt-1`}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[var(--ink-soft)]" htmlFor={`team-email-${index}`}>
                  Email
                </label>
                <input
                  id={`team-email-${index}`}
                  type="email"
                  value={member.email || ""}
                  onChange={(e) => updateTeam(index, "email", e.target.value)}
                  placeholder="jane@…"
                  className={`${denseFieldClass} mt-1`}
                />
              </div>
              <button
                type="button"
                onClick={() =>
                  setTeam((prev) =>
                    prev.length <= 1 ? [emptyMember()] : prev.filter((_, i) => i !== index)
                  )
                }
                className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-ink-soft transition hover:bg-surface hover:text-warn"
                aria-label={`Remove teammate ${index + 1}`}
              >
                <TrashIcon className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      </section>

      <section
        id="golden-faqs"
        className={panel === "faqs" ? "space-y-3" : "hidden"}
      >
        <div className="flex flex-wrap items-end justify-between gap-2">
          <p className="text-xs text-[var(--ink-soft)]" aria-live="polite">
            {filledFaqCount} of {FAQ_MAX}
          </p>
          <button
            type="button"
            onClick={() => {
              setFaqs((prev) => [...prev, emptyFaq()]);
              setFaqPage(Math.floor(faqs.length / FAQ_PAGE_SIZE));
            }}
            disabled={faqs.length >= FAQ_MAX}
            className="rounded-lg border border-[var(--accent)]/40 px-3 py-1.5 text-xs font-medium text-[var(--accent-deep)] hover:bg-[var(--accent-soft)] disabled:opacity-60"
          >
            Add FAQ
          </button>
        </div>

        {filledFaqCount === 0 ? (
          <div className="rounded-xl border border-dashed border-[var(--line)] bg-white/70 px-4 py-3">
            <p className="text-sm text-[var(--ink-soft)]">Common questions</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {FAQ_STARTERS.map((starter) => (
                <button
                  key={starter.question}
                  type="button"
                  onClick={() =>
                    setFaqs((prev) => {
                      const next = [...prev];
                      const blank = next.findIndex(
                        (f) => !f.question.trim() && !f.answer.trim()
                      );
                      if (blank >= 0) next[blank] = { ...starter };
                      else if (next.length < FAQ_MAX) next.push({ ...starter });
                      return next;
                    })
                  }
                  className="rounded-xl border border-[var(--line)] bg-white px-3 py-1.5 text-left text-xs text-[var(--ink)] hover:border-[var(--accent)]"
                >
                  {starter.question}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        <div className="space-y-2">
          {visibleFaqs.map((faq, localIndex) => {
            const index = safeFaqPage * FAQ_PAGE_SIZE + localIndex;
            return (
            <div key={`faq-${index}`} className="space-y-1.5 rounded-xl border border-line bg-white px-3 py-2.5">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-medium uppercase tracking-wide text-[var(--ink-soft)]">
                  FAQ {index + 1}
                </p>
                <button
                  type="button"
                  onClick={() =>
                    setFaqs((prev) =>
                      prev.length <= 1 ? [emptyFaq()] : prev.filter((_, i) => i !== index)
                    )
                  }
                  className="text-xs text-[var(--ink-soft)] hover:text-[var(--warn)]"
                  aria-label={`Remove FAQ ${index + 1}`}
                >
                  Remove
                </button>
              </div>
              <div>
                <label className="block text-xs font-medium text-[var(--ink-soft)]" htmlFor={`faq-q-${index}`}>
                  Question
                </label>
                <input
                  id={`faq-q-${index}`}
                  value={faq.question}
                  maxLength={FAQ_QUESTION_MAX}
                  onChange={(e) => updateFaq(index, "question", e.target.value)}
                  placeholder="Do you have parking?"
                  aria-invalid={faqDupIndexes.has(index) || undefined}
                  aria-describedby={
                    faqDupIndexes.has(index) ? `faq-dup-${index}` : undefined
                  }
                  className={`${fieldClass} mt-1 py-2`}
                />
                {faqDupIndexes.has(index) ? (
                  <p id={`faq-dup-${index}`} className="mt-1 text-xs text-[var(--warn)]" role="status">
                    Same as another FAQ. Keep one clear wording.
                  </p>
                ) : null}
              </div>
              <div>
                <label className="block text-xs font-medium text-[var(--ink-soft)]" htmlFor={`faq-a-${index}`}>
                  Answer
                </label>
                <textarea
                  id={`faq-a-${index}`}
                  value={faq.answer}
                  maxLength={FAQ_ANSWER_MAX}
                  onChange={(e) => updateFaq(index, "answer", e.target.value)}
                  rows={2}
                  placeholder="Yes, free parking behind the building."
                  className={`${fieldClass} mt-1 py-2 leading-relaxed`}
                />
                <p className="mt-0.5 text-xs text-[var(--ink-soft)]">
                  {faq.answer.length}/{FAQ_ANSWER_MAX}
                </p>
              </div>
            </div>
            );
          })}
          <CatalogPager
            page={safeFaqPage}
            pageSize={FAQ_PAGE_SIZE}
            total={faqs.length}
            noun="FAQ"
            onPrev={() => setFaqPage((p) => Math.max(0, p - 1))}
            onNext={() => setFaqPage((p) => Math.min(faqPageCount - 1, p + 1))}
          />
        </div>
      </section>

      {state.error ? (
        <p className="text-sm text-warn" role="alert">
          {state.error}
        </p>
      ) : null}
      {flash && !state.error ? (
        <p className="text-sm text-ok" role="status">
          {flash}
        </p>
      ) : null}
        </div>
      </div>
    </form>
  );
}
