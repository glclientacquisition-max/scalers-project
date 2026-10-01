"use client";

import { useActionState, useEffect, useMemo, useState, type ReactNode } from "react";
import type { FaqEntry, TeamDirectoryEntry, TenantRow } from "@/lib/supabase";
import {
  canonicalizeAgentTone,
  TONE_LABELS,
  TONE_OPTIONS,
  type OnboardingTone,
} from "@/lib/onboarding";
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
  normalizeFaqKey,
} from "@/lib/faqs";
import { SERVICES_PASTE_POOLS, placeholderPool } from "@/lib/deskPlaceholders";
import { useMountedPoolPick } from "@/lib/useMountedPoolPick";
import {
  parseVertical,
  verticalBlurb,
  verticalSettingsOptions,
  type BusinessVertical,
} from "@/lib/vertical";
import {
  firstDialableTeammate,
  liveConnectBlurb,
  parseHandoffMode,
  type HandoffMode,
} from "@/lib/handoffMode";
import {
  displaySonioxVoiceLabel,
  getDefaultSonioxVoiceIdSync,
  listCuratedSonioxVoicesSync,
  resolveLiveCallVoiceId,
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
import { CoverageAreaField } from "@/components/CoverageAreaField";
import { PronunciationCoach } from "@/components/PronunciationCoach";
import { deskShiftClass } from "@/components/ui/deskChrome";
import { notify } from "@/components/ui/DeskNotice";
import { Pagination } from "@/components/ui/Pagination";
import {
  ExpandTextarea,
  SettingsGroup,
  SettingsPageHeader,
  SettingsRow,
  SettingsSegmented,
  SettingsSelect,
  SettingsStack,
  ToolSwitch,
  TrashIcon,
  compactTextareaExpandHandlers,
  settingsBlockTitleClass,
  settingsConsoleClass,
  settingsDenseFieldClass,
  settingsFieldClass,
  settingsGhostButtonClass,
  settingsPanelClass,
  settingsTableFieldClass,
  settingsTrashButtonClass,
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
import {
  assertPreviewAudioPlayable,
  NO_VOICE_SAMPLE_COPY,
  objectUrlFromPreviewResponse,
  previewErrorCopy,
} from "@/lib/previewAudio";
import {
  EMPTY_TEAM_NOTIFY_FLAGS,
  normalizeTeamDirectory,
} from "@/lib/teamNotify";
import type { SettingsPanel } from "@/lib/businessSettingsNav";

export type { SettingsPanel } from "@/lib/businessSettingsNav";

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
  return canonicalizeAgentTone(String(tenant.agent_tone || "")) || "";
}

function normalizeTeam(
  raw: TenantRow["team_directory"],
  ownerPhone?: string
): TeamDirectoryEntry[] {
  return normalizeTeamDirectory(raw, { ownerPhone });
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
  ...EMPTY_TEAM_NOTIFY_FLAGS,
});

/** Permission kinds on the three saved notify flags. Channels stay on Alerts. */
const TEAM_NOTIFY_CHANNEL_NOTE = "SMS, WhatsApp, and email follow Alerts.";
const TEAM_NOTIFY_FLAGS: Array<{
  key: "receives_escalation" | "receives_inbox" | "receives_ops";
  label: string;
}> = [
  { key: "receives_escalation", label: "Escalate" },
  { key: "receives_inbox", label: "Inbox" },
  { key: "receives_ops", label: "Ops" },
];
const emptyFaq = (): FaqEntry => ({ question: "", answer: "" });

type PolicyFieldId = (typeof POLICY_FIELDS)[number]["id"];

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

function placeLocationLine(loc: Pick<BusinessLocation, "label" | "address" | "landmark">): string {
  return [loc.label, loc.address, loc.landmark]
    .map((part) => part.trim())
    .filter(Boolean)
    .join(" · ");
}

const initial: SettingsCompileState = {};

const fieldClass = settingsFieldClass;
const tableFieldClass = settingsTableFieldClass;
const denseFieldClass = settingsDenseFieldClass;

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
  onPage,
}: {
  /** Zero-based page. */
  page: number;
  pageSize: number;
  total: number;
  noun: string;
  onPage: (page: number) => void;
}) {
  return (
    <Pagination
      page={page + 1}
      pageSize={pageSize}
      total={total}
      noun={noun}
      onPage={(next) => onPage(next - 1)}
      className="border-t border-line bg-surface-canvas px-3 py-3"
    />
  );
}

export function TenantForm({
  tenant,
  panel = "identity",
  curatedVoices,
  heading = null,
  sidebar = null,
  liveTransferExecutor = false,
  showBack = true,
}: {
  tenant: TenantRow;
  panel?: SettingsPanel;
  curatedVoices?: CuratedSonioxVoice[];
  heading?: string | null;
  sidebar?: ReactNode;
  liveTransferExecutor?: boolean;
  showBack?: boolean;
}) {
  const voiceOptions =
    curatedVoices && curatedVoices.length
      ? curatedVoices
      : listCuratedSonioxVoicesSync();
  const [businessName, setBusinessName] = useState(tenant.business_name || "");
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
  const [bulkServicesText, setBulkServicesText] = useState("");
  const [bulkServicesError, setBulkServicesError] = useState<string | null>(null);
  const [bulkProductsText, setBulkProductsText] = useState("");
  const [bulkProductsError, setBulkProductsError] = useState<string | null>(null);
  const [servicePage, setServicePage] = useState(0);
  const [productPage, setProductPage] = useState(0);
  const [faqPage, setFaqPage] = useState(0);
  const [unknownFallback, setUnknownFallback] = useState(
    tenant.unknown_answer_fallback || ""
  );
  const [agentName, setAgentName] = useState(tenant.agent_name || "");
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
  const servicesPasteExample = useMountedPoolPick(
    placeholderPool(SERVICES_PASTE_POOLS, vertical)
  );
  const [handoffMode, setHandoffMode] = useState<HandoffMode>(() =>
    parseHandoffMode(tenant.handoff_mode)
  );
  const [locations, setLocations] = useState<BusinessLocation[]>(() => {
    const rows = normalizeBusinessLocations(tenant.business_locations);
    return rows.length ? rows : [emptyLocation()];
  });
  const [openLocationIndexes, setOpenLocationIndexes] = useState<number[]>([]);
  const [policies, setPolicies] = useState<BusinessPolicies>(() =>
    normalizeBusinessPolicies(tenant.business_policies)
  );
  const [openPolicyIds, setOpenPolicyIds] = useState<PolicyFieldId[]>(() => {
    const initial = normalizeBusinessPolicies(tenant.business_policies);
    return POLICY_FIELDS.filter((field) => String(initial[field.id] || "").trim()).map(
      (field) => field.id
    );
  });
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
    const rows = normalizeTeam(
      tenant.team_directory,
      tenant.whatsapp_notification_number
    );
    return rows.length ? rows : [emptyMember()];
  });
  const liveDest = firstDialableTeammate(team);
  const [faqs, setFaqs] = useState<FaqEntry[]>(() => normalizeFaqs(tenant.faqs));
  const [ttsLexicon, setTtsLexicon] = useState<TtsLexiconEntry[]>(() =>
    parseTtsLexicon(tenant.tts_lexicon)
  );
  const [state, formAction, pending] = useActionState(saveAndCompileSettings, initial);

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
    if (state.ok) notify("Saved");
  }, [state]);

  useEffect(() => {
    return () => {
      if (voiceSampleUrl) URL.revokeObjectURL(voiceSampleUrl);
    };
  }, [voiceSampleUrl]);

  async function generateVoiceSample() {
    const sample =
      agentName && businessName
        ? `Hello, you've reached ${businessName}, this is ${agentName} speaking. How can I help?`
        : "Hello, how can I help you today?";
    const liveVoiceId = resolveLiveCallVoiceId(sonioxVoiceId, voiceOptions);
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
          voiceId: liveVoiceId,
        }),
      });
      const preview = await objectUrlFromPreviewResponse(res);
      try {
        await assertPreviewAudioPlayable(preview.url);
      } catch (probeErr) {
        URL.revokeObjectURL(preview.url);
        throw probeErr;
      }
      setVoiceSampleUrl(preview.url);
    } catch (err) {
      setVoiceSampleError(previewErrorCopy(err));
    } finally {
      setVoiceSampleLoading(false);
    }
  }

  function updateTeam(
    index: number,
    key: keyof TeamDirectoryEntry,
    value: string | boolean
  ) {
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

  function toggleLocationDetails(index: number) {
    setOpenLocationIndexes((prev) =>
      prev.includes(index) ? prev.filter((i) => i !== index) : [...prev, index]
    );
  }

  function removeLocation(index: number) {
    setLocations((prev) => prev.filter((_, i) => i !== index));
    setOpenLocationIndexes((prev) =>
      prev.flatMap((i) => {
        if (i === index) return [];
        return [i > index ? i - 1 : i];
      })
    );
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

  const firstPlaceLine = placeLocationLine(locations[0] || emptyLocation());
  const locationNotesField =
    panel === "locations" && firstPlaceLine ? firstPlaceLine : locationNotes;

  return (
    <form id={TENANT_SETTINGS_FORM_ID} action={formAction}>
      <div className={settingsConsoleClass}>
        {sidebar}

        <div className={`${settingsPanelClass} space-y-4`}>
          <SettingsPageHeader
            businessName={tenant.business_name?.trim() || "Business"}
            lineLive={false}
            showBack={showBack}
            title={heading}
            alert={state.error}
            action={
              panel === "pronunciation" ? undefined : (
                <TenantSettingsSaveButton pending={pending} />
              )
            }
          />

      <input type="hidden" name="id" value={tenant.id} />
      <input type="hidden" name="settings_scope" value={panel} />
      <input type="hidden" name="business_name" value={businessName} />
      <input type="hidden" name="services_offered" value={servicesOfferedSummary} />
      <input type="hidden" name="services_catalog" value={servicesJson} />
      <input type="hidden" name="product_catalog" value={productsJson} />
      <input type="hidden" name="social_handles" value={socialJson} />
      <input type="hidden" name="services_notes" value={servicesNotes} />
      <input type="hidden" name="business_hours" value={businessHoursSummary} />
      <input type="hidden" name="hours_schedule" value={hoursScheduleJson} />
      <input type="hidden" name="location_notes" value={locationNotesField} />
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

      <section className={panel === "identity" ? "space-y-6" : "hidden"}>
        <SettingsGroup title="Assistant">
          <SettingsRow label="Assistant name" htmlFor="agent_name">
            <input
              id="agent_name"
              value={agentName}
              onChange={(e) => setAgentName(e.target.value)}
              placeholder="Aisha"
              maxLength={40}
              className={denseFieldClass}
            />
          </SettingsRow>
          <SettingsRow label="Tone" htmlFor="agent_tone">
            <SettingsSelect
              id="agent_tone"
              label="Tone"
              value={tone}
              placeholder="Tone"
              onChange={(id) => setTone(id)}
              options={TONE_OPTIONS.map((opt) => ({
                id: opt.id,
                label: TONE_LABELS[opt.id],
              }))}
            />
          </SettingsRow>
        </SettingsGroup>

        <SettingsGroup title="Business">
          <SettingsRow label="Business name" htmlFor="business_name">
            <input
              id="business_name"
              value={businessName}
              onChange={(e) => setBusinessName(e.target.value)}
              placeholder="Westlands Books"
              className={denseFieldClass}
            />
          </SettingsRow>
          <SettingsRow
            label="Business type"
            htmlFor="business_vertical"
            hint={verticalBlurb(vertical)}
          >
            <SettingsSelect
              id="business_vertical"
              label="Business type"
              value={vertical}
              onChange={setVertical}
              options={verticalSettingsOptions(vertical).map((opt) => ({
                id: opt.id,
                label: opt.label,
              }))}
            />
          </SettingsRow>
        </SettingsGroup>

        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3 px-1">
            <p className={settingsBlockTitleClass}>Public contacts</p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => addSocialChannel("phone")}
                className={settingsGhostButtonClass}
              >
                Add phone
              </button>
              <button
                type="button"
                onClick={() => addSocialChannel("whatsapp")}
                className={settingsGhostButtonClass}
              >
                Add WhatsApp
              </button>
              <button
                type="button"
                onClick={() => addSocialChannel("instagram")}
                className={settingsGhostButtonClass}
              >
                Add social
              </button>
            </div>
          </div>

          {socialHandles.channels.length === 0 ? null : (
            <>
            <div className="divide-y divide-line overflow-hidden rounded-xl border border-line lg:hidden">
              {socialHandles.channels.map((channel, index) => (
                <div
                  key={`social-m-${index}`}
                  className="grid grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)_2.75rem] items-center gap-2 px-3 py-2"
                >
                  <div className="min-w-0">
                    <label className="sr-only" htmlFor={`social-kind-m-${index}`}>
                      Type
                    </label>
                    <select
                      id={`social-kind-m-${index}`}
                      value={channel.kind}
                      onChange={(e) => updateSocialChannel(index, "kind", e.target.value)}
                      className={denseFieldClass}
                    >
                      {SOCIAL_CHANNEL_KINDS.map((k) => (
                        <option key={k.id} value={k.id}>
                          {k.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="min-w-0">
                    <label className="sr-only" htmlFor={`social-label-m-${index}`}>
                      Label
                    </label>
                    <input
                      id={`social-label-m-${index}`}
                      value={channel.label}
                      onChange={(e) => updateSocialChannel(index, "label", e.target.value)}
                      placeholder="Main"
                      className={denseFieldClass}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => removeSocialChannel(index)}
                    className={settingsTrashButtonClass}
                    aria-label={`Remove contact ${index + 1}`}
                  >
                    <TrashIcon className="h-4 w-4" />
                  </button>
                  <div className="col-span-3 min-w-0">
                    <label className="sr-only" htmlFor={`social-value-m-${index}`}>
                      Handle / URL
                    </label>
                    <input
                      id={`social-value-m-${index}`}
                      value={channel.value}
                      onChange={(e) => updateSocialChannel(index, "value", e.target.value)}
                      placeholder={
                        SOCIAL_CHANNEL_KINDS.find((k) => k.id === channel.kind)
                          ?.placeholder || ""
                      }
                      className={denseFieldClass}
                    />
                  </div>
                </div>
              ))}
            </div>
            <div className="hidden overflow-hidden rounded-xl border border-line lg:block">
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
                  <tbody className="divide-y divide-line bg-surface">
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
                            className={settingsTrashButtonClass}
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
            <p className={settingsBlockTitleClass}>Services</p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => {
                  setServices((prev) => [...prev, emptyService()]);
                  setServicePage(Math.floor(services.length / SERVICE_PAGE_SIZE));
                }}
                className={settingsGhostButtonClass}
              >
                Add service
              </button>
            </div>
          </div>

          <details className="rounded-xl border border-line bg-surface">
            <summary
              className={`flex min-h-11 cursor-pointer list-none items-center px-3 text-sm font-medium text-ink ${deskShiftClass} focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent`}
            >
              Paste list
            </summary>
            <div className="space-y-3 border-t border-line p-3">
              <button
                type="button"
                onClick={() => addBlankServiceRows(3)}
                className={settingsGhostButtonClass}
              >
                Add 3
              </button>
              <label className="sr-only" htmlFor="bulk_services">
                Paste list
              </label>
              <textarea
                id="bulk_services"
                value={bulkServicesText}
                onChange={(e) => {
                  setBulkServicesText(e.target.value);
                  if (bulkServicesError) setBulkServicesError(null);
                }}
                rows={2}
                {...compactTextareaExpandHandlers}
                placeholder={servicesPasteExample}
                className={`${denseFieldClass} text-sm leading-relaxed`}
              />
              <details className="text-xs text-ink-soft">
                <summary className="cursor-pointer font-medium text-ink">
                  Spreadsheet format
                </summary>
                <p className="mt-2 leading-relaxed">
                  Columns:{" "}
                  <span className="font-medium text-ink">
                    name | price | notes | out of scope
                  </span>
                </p>
              </details>

              {bulkPreview.length > 0 ? (
                <div className="rounded-xl border border-line bg-surface px-3 py-2">
                  <p className="text-xs font-medium text-ink">
                    Ready to add {bulkPreview.length} service
                    {bulkPreview.length === 1 ? "" : "s"}
                  </p>
                  <ul className="mt-2 space-y-1 text-sm text-ink-soft">
                    {bulkPreview.slice(0, 8).map((row, i) => (
                      <li key={`${row.name}-${i}`}>
                        <span className="font-medium text-ink">{row.name}</span>
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
                <p className="text-sm text-warn" role="alert">
                  {bulkServicesError}
                </p>
              ) : null}
              <button
                type="button"
                onClick={applyBulkServices}
                disabled={!bulkPreview.length}
                className={settingsGhostButtonClass}
              >
                Add to services
              </button>

              {vertical === "home_services" ? null : (
                <div className="space-y-3 border-t border-line pt-3">
                  <label className="block text-sm font-medium" htmlFor="bulk_products">
                    Paste products
                  </label>
                  <textarea
                    id="bulk_products"
                    value={bulkProductsText}
                    onChange={(e) => {
                      setBulkProductsText(e.target.value);
                      if (bulkProductsError) setBulkProductsError(null);
                    }}
                    rows={2}
                    {...compactTextareaExpandHandlers}
                    placeholder={
                      "name,price,category,in_stock\nAtomic Habits,2500 KES,Self-help,yes\n\nOr:\nAtomic Habits - 2,500 KES"
                    }
                    className={`${denseFieldClass} text-sm leading-relaxed`}
                  />
                  {bulkProductPreview.length ? (
                    <p className="text-xs text-ink-soft">
                      Ready to add {bulkProductPreview.length} product
                      {bulkProductPreview.length === 1 ? "" : "s"}
                    </p>
                  ) : null}
                  {bulkProductsError ? (
                    <p className="text-sm text-warn">{bulkProductsError}</p>
                  ) : null}
                  <button
                    type="button"
                    onClick={applyBulkProducts}
                    disabled={!bulkProductPreview.length}
                    className={settingsGhostButtonClass}
                  >
                    Add to catalogue
                  </button>
                </div>
              )}
            </div>
          </details>

          <div className="divide-y divide-line overflow-hidden rounded-xl border border-line lg:hidden">
            {visibleServices.map((service, localIndex) => {
              const index = safeServicePage * SERVICE_PAGE_SIZE + localIndex;
              return (
                <div key={`service-m-${index}`} className="grid grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_2.75rem] items-center gap-2 px-3 py-2">
                  <div className="min-w-0">
                    <label className="sr-only" htmlFor={`svc-name-m-${index}`}>Name</label>
                    <input id={`svc-name-m-${index}`} value={service.name} onChange={(e) => updateService(index, "name", e.target.value)} placeholder={vertical === "retail" ? "Book sourcing / special orders" : "Home cleaning"} className={denseFieldClass} />
                  </div>
                  <div className="min-w-0">
                    <label className="sr-only" htmlFor={`svc-price-m-${index}`}>Price</label>
                    <input id={`svc-price-m-${index}`} value={service.price_range} onChange={(e) => updateService(index, "price_range", e.target.value)} placeholder="from 2,500 KES" className={denseFieldClass} />
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      setServices((prev) =>
                        prev.length <= 1 ? [emptyService()] : prev.filter((_, i) => i !== index)
                      )
                    }
                    className={settingsTrashButtonClass}
                    aria-label={`Remove service ${index + 1}`}
                  >
                    <TrashIcon className="h-4 w-4" />
                  </button>
                  <div className="min-w-0">
                    <label className="sr-only" htmlFor={`svc-notes-m-${index}`}>Notes</label>
                    <input id={`svc-notes-m-${index}`} value={service.notes} onChange={(e) => updateService(index, "notes", e.target.value)} placeholder="Free quotation" className={denseFieldClass} />
                  </div>
                  <div className="col-span-2 min-w-0">
                    <label className="sr-only" htmlFor={`svc-oos-m-${index}`}>Out of scope</label>
                    <input id={`svc-oos-m-${index}`} value={service.out_of_scope} onChange={(e) => updateService(index, "out_of_scope", e.target.value)} placeholder="No commercial offices" className={denseFieldClass} />
                  </div>
                </div>
              );
            })}
            <CatalogPager
              page={safeServicePage}
              pageSize={SERVICE_PAGE_SIZE}
              total={services.length}
              noun="service"
              onPage={setServicePage}
            />
          </div>

          <div className="hidden overflow-hidden rounded-xl border border-line lg:block">
            <div className="overflow-x-auto">
              <table className="w-full table-fixed text-sm">
                <thead>
                  <tr className="border-b border-line bg-surface-canvas text-left text-xs font-medium uppercase tracking-wide text-ink-soft">
                    <th className="min-w-0 px-3 py-2.5 font-medium">Name</th>
                    <th className="px-3 py-2.5 font-medium">Price</th>
                    <th className="px-3 py-2.5 font-medium">Notes</th>
                    <th className="px-3 py-2.5 font-medium">Out of scope</th>
                    <th className="px-3 py-2.5 font-medium w-16">
                      <span className="sr-only">Action</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line bg-surface">
                  {visibleServices.map((service, localIndex) => {
                    const index = safeServicePage * SERVICE_PAGE_SIZE + localIndex;
                    return (
                      <tr key={`service-${index}`} className="align-middle">
                        <td className="min-w-0 px-3 py-2">
                          <label className="sr-only" htmlFor={`svc-name-${index}`}>
                            Service name
                          </label>
                          <input
                            id={`svc-name-${index}`}
                            value={service.name}
                            title={service.name || undefined}
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
                            className={settingsTrashButtonClass}
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
              onPage={setServicePage}
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

        {vertical === "home_services" ? null : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <p className={settingsBlockTitleClass}>Products</p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => {
                  setProducts((prev) => [...prev, emptyProduct()]);
                  setProductPage(Math.floor(products.length / PRODUCT_PAGE_SIZE));
                }}
                className={settingsGhostButtonClass}
              >
                Add product
              </button>
            </div>
          </div>

          {products.length === 0 ? null : (
            <>
            <div className="divide-y divide-line overflow-hidden rounded-xl border border-line lg:hidden">
              {visibleProducts.map((product, localIndex) => {
                const index = safeProductPage * PRODUCT_PAGE_SIZE + localIndex;
                return (
                  <div key={`product-m-${index}`} className="grid grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)_2.75rem] items-center gap-2 px-3 py-2">
                    <div className="min-w-0">
                      <label className="sr-only" htmlFor={`prod-name-m-${index}`}>Name</label>
                      <input id={`prod-name-m-${index}`} value={product.name} onChange={(e) => updateProduct(index, "name", e.target.value)} placeholder="Atomic Habits" className={denseFieldClass} />
                    </div>
                    <div className="min-w-0">
                      <label className="sr-only" htmlFor={`prod-price-m-${index}`}>Price</label>
                      <input id={`prod-price-m-${index}`} value={product.price} onChange={(e) => updateProduct(index, "price", e.target.value)} placeholder="2,500 KES" className={denseFieldClass} />
                    </div>
                    <button type="button" onClick={() => setProducts((prev) => prev.filter((_, i) => i !== index))} className={settingsTrashButtonClass} aria-label={`Remove product ${index + 1}`}>
                      <TrashIcon className="h-4 w-4" />
                    </button>
                    <div className="min-w-0">
                      <label className="sr-only" htmlFor={`prod-cat-m-${index}`}>Category</label>
                      <input id={`prod-cat-m-${index}`} value={product.category} onChange={(e) => updateProduct(index, "category", e.target.value)} placeholder="Self-help" className={denseFieldClass} />
                    </div>
                    <div className="col-span-2 min-w-0">
                      <label className="sr-only" htmlFor={`prod-stock-m-${index}`}>Stock</label>
                      <select id={`prod-stock-m-${index}`} value={product.in_stock || ""} onChange={(e) => updateProduct(index, "in_stock", e.target.value)} className={denseFieldClass}>
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
                onPage={setProductPage}
              />
            </div>
            <div className="hidden overflow-hidden rounded-xl border border-line lg:block">
              <div className="overflow-x-auto">
                <table className="w-full table-fixed text-sm">
                  <thead>
                    <tr className="border-b border-line bg-surface-canvas text-left text-xs font-medium uppercase tracking-wide text-ink-soft">
                      <th className="min-w-0 px-3 py-2.5 font-medium">Name</th>
                      <th className="px-3 py-2.5 font-medium">Price</th>
                      <th className="px-3 py-2.5 font-medium">Category</th>
                      <th className="px-3 py-2.5 font-medium">Stock</th>
                      <th className="px-3 py-2.5 font-medium w-12">
                        <span className="sr-only">Remove</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line bg-surface">
                    {visibleProducts.map((product, localIndex) => {
                      const index = safeProductPage * PRODUCT_PAGE_SIZE + localIndex;
                      return (
                        <tr key={`product-${index}`} className="align-middle">
                          <td className="min-w-0 px-3 py-2">
                            <label className="sr-only" htmlFor={`prod-name-${index}`}>
                              Product name
                            </label>
                            <input
                              id={`prod-name-${index}`}
                              value={product.name}
                              title={product.name || undefined}
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
                          <td className="px-2 py-2">
                            <button
                              type="button"
                              onClick={() =>
                                setProducts((prev) => prev.filter((_, i) => i !== index))
                              }
                              className={settingsTrashButtonClass}
                              aria-label={`Remove product ${index + 1}`}
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
                page={safeProductPage}
                pageSize={PRODUCT_PAGE_SIZE}
                total={products.length}
                noun="product"
                onPage={setProductPage}
              />
            </div>
            </>
          )}
        </div>
        )}
      </section>

      <section className={panel === "hours" ? "space-y-6" : "hidden"}>
        <SettingsGroup title="Hours">
          <div className="hidden bg-surface-canvas px-3 py-2 text-xs font-medium uppercase tracking-wide text-gray-500 lg:grid lg:grid-cols-[minmax(5.5rem,7rem)_3.5rem_minmax(0,1fr)_minmax(0,1fr)] lg:items-center lg:gap-x-3">
            <span>Day</span>
            <span>Open</span>
            <span>Opens</span>
            <span>Closes</span>
          </div>
          {DAY_ORDER.map((day) => {
            const slot = hoursSchedule.days[day];
            const open = Boolean(slot);
            return (
              <div key={day} className="px-4 py-2 lg:px-3 lg:py-1.5">
                <div className="flex min-h-12 items-center justify-between gap-3 lg:hidden">
                  <span className="min-w-0 truncate text-sm font-medium text-ink">
                    {DAY_LABELS[day]}
                  </span>
                  <ToolSwitch
                    checked={open}
                    onChange={(next) => setDayOpen(day, next)}
                    label={`${DAY_LABELS[day]} open`}
                  />
                </div>
                {open && slot ? (
                  <div className="mt-2 grid grid-cols-2 gap-2 lg:hidden">
                    <div className="min-w-0">
                      <label
                        className="block text-xs font-medium text-ink-soft"
                        htmlFor={`open-m-${day}`}
                      >
                        Opens
                      </label>
                      <input
                        id={`open-m-${day}`}
                        type="time"
                        value={slot.open}
                        onChange={(e) => setDayTime(day, "open", e.target.value)}
                        className="mt-1 min-h-11 min-w-0 w-full rounded-lg border border-line bg-surface px-2 py-1.5 text-sm text-ink outline-none placeholder:text-ink-soft/70 focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent"
                      />
                    </div>
                    <div className="min-w-0">
                      <label
                        className="block text-xs font-medium text-ink-soft"
                        htmlFor={`close-m-${day}`}
                      >
                        Closes
                      </label>
                      <input
                        id={`close-m-${day}`}
                        type="time"
                        value={slot.close}
                        onChange={(e) => setDayTime(day, "close", e.target.value)}
                        className="mt-1 min-h-11 min-w-0 w-full rounded-lg border border-line bg-surface px-2 py-1.5 text-sm text-ink outline-none placeholder:text-ink-soft/70 focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent"
                      />
                    </div>
                  </div>
                ) : null}
                <div className="hidden lg:grid lg:grid-cols-[minmax(5.5rem,7rem)_3.5rem_minmax(0,1fr)_minmax(0,1fr)] lg:items-center lg:gap-x-3">
                  <span className="min-w-0 truncate text-sm font-medium text-ink">
                    {DAY_LABELS[day]}
                  </span>
                  <ToolSwitch
                    checked={open}
                    onChange={(next) => setDayOpen(day, next)}
                    label={`${DAY_LABELS[day]} open`}
                  />
                  {open && slot ? (
                    <>
                      <label className="sr-only" htmlFor={`open-${day}`}>
                        Opens
                      </label>
                      <input
                        id={`open-${day}`}
                        type="time"
                        value={slot.open}
                        onChange={(e) => setDayTime(day, "open", e.target.value)}
                        className="min-h-11 min-w-0 w-full rounded-lg border border-line bg-surface px-2 py-1.5 text-sm text-ink outline-none placeholder:text-ink-soft/70 focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent"
                      />
                      <label className="sr-only" htmlFor={`close-${day}`}>
                        Closes
                      </label>
                      <input
                        id={`close-${day}`}
                        type="time"
                        value={slot.close}
                        onChange={(e) => setDayTime(day, "close", e.target.value)}
                        className="min-h-11 min-w-0 w-full rounded-lg border border-line bg-surface px-2 py-1.5 text-sm text-ink outline-none placeholder:text-ink-soft/70 focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent"
                      />
                    </>
                  ) : (
                    <span className="col-span-2 text-xs text-ink-soft">Closed</span>
                  )}
                </div>
              </div>
            );
          })}
          <div className="space-y-1.5 px-4 py-3">
            <p className="text-sm font-medium text-ink">When closed</p>
            <SettingsSegmented
              label="When closed"
              value={afterHoursMode}
              options={AFTER_HOURS_OPTIONS.map((opt) => ({
                id: opt.id,
                label: opt.label,
              }))}
              onChange={setAfterHoursMode}
            />
          </div>
        </SettingsGroup>
      </section>

      <section
        className={panel === "locations" ? "space-y-3" : "hidden"}
      >
        <div className="flex flex-wrap items-end justify-between gap-3">
          <p className={settingsBlockTitleClass}>Places</p>
          <button
            type="button"
            disabled={locations.length >= LOCATIONS_MAX}
            onClick={() =>
              setLocations((prev) =>
                prev.length >= LOCATIONS_MAX ? prev : [...prev, emptyLocation()]
              )
            }
            className={`${settingsGhostButtonClass} disabled:opacity-50`}
          >
            Add place
          </button>
        </div>
        <div className="overflow-hidden rounded-xl border border-line">
          <div className="grid grid-cols-[minmax(0,7rem)_minmax(0,1fr)_2.75rem_2.75rem] items-center gap-2 border-b border-line bg-surface-canvas px-3 py-2 text-xs font-medium uppercase tracking-wide text-ink-soft">
            <span>Label</span>
            <span>Area</span>
            <span className="sr-only">Details</span>
            <span className="sr-only">Remove</span>
          </div>
          {locations.map((loc, index) => {
            const placeOpen = openLocationIndexes.includes(index);
            const placeDetailLabel =
              vertical === "home_services"
                ? "Landmark, directions, and notes"
                : "Landmark, directions, and coverage";
            return (
            <div key={`loc-${index}`} className="border-b border-line last:border-b-0">
              <div className="grid grid-cols-[minmax(0,7rem)_minmax(0,1fr)_2.75rem_2.75rem] items-center gap-2 px-3 py-2">
                <div className="min-w-0">
                  <label className="sr-only" htmlFor={`loc-label-${index}`}>
                    Label
                  </label>
                  <input
                    id={`loc-label-${index}`}
                    value={loc.label}
                    onChange={(e) => {
                      updateLocation(index, "label", e.target.value);
                      if (index === 0) {
                        setLocationNotes(
                          placeLocationLine({
                            label: e.target.value,
                            address: loc.address,
                            landmark: loc.landmark,
                          })
                        );
                      }
                    }}
                    placeholder="Main shop"
                    className={`${denseFieldClass} min-w-0 truncate`}
                  />
                </div>
                <div className="min-w-0">
                  <label className="sr-only" htmlFor={`loc-address-${index}`}>
                    Area
                  </label>
                  <ExpandTextarea
                    id={`loc-address-${index}`}
                    value={loc.address}
                    maxLength={200}
                    onChange={(value) => {
                      updateLocation(index, "address", value);
                      if (index === 0) {
                        setLocationNotes(
                          placeLocationLine({
                            label: loc.label,
                            address: value,
                            landmark: loc.landmark,
                          })
                        );
                      }
                    }}
                    placeholder="Westlands, Nairobi"
                    className="min-w-0 truncate break-words [overflow-wrap:anywhere]"
                  />
                </div>
                <button
                  type="button"
                  aria-expanded={placeOpen}
                  aria-label={placeDetailLabel}
                  onClick={() => toggleLocationDetails(index)}
                  className={`inline-flex h-11 w-11 min-h-11 min-w-11 shrink-0 items-center justify-center rounded-lg text-ink-soft ${deskShiftClass} hover:bg-surface hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40`}
                >
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.75"
                    className={`h-4 w-4 ${placeOpen ? "rotate-90" : ""}`}
                    aria-hidden="true"
                  >
                    <path d="M9 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
                <div className="flex items-start justify-end">
                  {locations.length > 1 ? (
                    <button
                      type="button"
                      onClick={() => removeLocation(index)}
                      className={settingsTrashButtonClass}
                      aria-label={`Remove location ${index + 1}`}
                    >
                      <TrashIcon className="h-4 w-4" />
                    </button>
                  ) : (
                    <span className="h-11 w-11" aria-hidden />
                  )}
                </div>
              </div>
              {placeOpen ? (
                <div className="grid grid-cols-1 gap-3 px-3 pb-3">
                  <div className="min-w-0">
                    <label
                      className="block text-xs font-medium text-ink-soft"
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
                          setLocationNotes(
                            placeLocationLine({
                              label: loc.label,
                              address: loc.address,
                              landmark: e.target.value,
                            })
                          );
                        }
                      }}
                      placeholder="Opposite Naivas"
                      className={`${denseFieldClass} mt-1`}
                    />
                  </div>
                  <div className="min-w-0">
                    <label
                      className="block text-xs font-medium text-ink-soft"
                      htmlFor={`loc-directions-${index}`}
                    >
                      Directions
                    </label>
                    <textarea
                      id={`loc-directions-${index}`}
                      value={loc.directions}
                      onChange={(e) => updateLocation(index, "directions", e.target.value)}
                      rows={2}
                      placeholder="From Waiyaki Way, turn at the Shell. Left side."
                      className={`${denseFieldClass} mt-1 leading-relaxed`}
                    />
                  </div>
                  <div className="min-w-0">
                    <label
                      className="block text-xs font-medium text-ink-soft"
                      htmlFor={`loc-coverage-${index}`}
                    >
                      {vertical === "home_services" ? "Notes" : "Coverage"}
                    </label>
                    <ExpandTextarea
                      id={`loc-coverage-${index}`}
                      value={loc.coverage_notes}
                      maxLength={300}
                      onChange={(value) =>
                        updateLocation(index, "coverage_notes", value)
                      }
                      placeholder={
                        vertical === "home_services"
                          ? "Call ahead for the gate"
                          : "Kiambu and Ruiru"
                      }
                      className="min-w-0 break-words [overflow-wrap:anywhere]"
                    />
                  </div>
                </div>
              ) : null}
            </div>
            );
          })}
        </div>
      </section>

      <section
        className={panel === "policies" ? "space-y-6" : "hidden"}
      >
        <SettingsGroup title="Rules">
          {vertical === "home_services" ? (
            <SettingsStack label="Coverage" htmlFor="policy-coverage">
              <CoverageAreaField
                id="policy-coverage"
                value={policies.coverage_areas || []}
                onChange={(coverage_areas) =>
                  setPolicies((prev) => ({ ...prev, coverage_areas }))
                }
              />
            </SettingsStack>
          ) : null}
          {POLICY_FIELDS.filter((field) => openPolicyIds.includes(field.id)).map((field) => (
            <SettingsStack
              key={field.id}
              label={field.label}
              htmlFor={`policy-${field.id}`}
            >
              <PolicyTextarea
                id={`policy-${field.id}`}
                value={policies[field.id]}
                onChange={(value) =>
                  setPolicies((prev) => ({ ...prev, [field.id]: value }))
                }
                placeholder={
                  field.id === "delivery" && vertical === "home_services"
                    ? "Same day before 2pm"
                    : field.placeholder
                }
              />
            </SettingsStack>
          ))}
          {openPolicyIds.length < POLICY_FIELDS.length ? (
            <div className="px-4 py-2">
              <label className="sr-only" htmlFor="add-policy-rule">
                Add rule
              </label>
              <select
                id="add-policy-rule"
                aria-label="Add rule"
                value=""
                onChange={(e) => {
                  const id = e.target.value as PolicyFieldId;
                  if (!id) return;
                  setOpenPolicyIds((prev) =>
                    prev.includes(id) ? prev : [...prev, id]
                  );
                }}
                className={`${settingsGhostButtonClass} w-auto`}
              >
                <option value="">Add rule</option>
                {POLICY_FIELDS.filter((field) => !openPolicyIds.includes(field.id)).map(
                  (field) => (
                    <option key={field.id} value={field.id}>
                      {field.label}
                    </option>
                  )
                )}
              </select>
            </div>
          ) : null}
        </SettingsGroup>

        <SettingsGroup title="When unsure">
          <SettingsStack label="What to say" htmlFor="unknown_answer_fallback">
            <PolicyTextarea
              id="unknown_answer_fallback"
              value={unknownFallback}
              onChange={setUnknownFallback}
              placeholder="A teammate will call you back today."
            />
          </SettingsStack>
        </SettingsGroup>
      </section>

            <section className={panel === "tools" ? "space-y-6" : "hidden"}>
        <SettingsGroup title="Voice">
          <SettingsRow label="Voice" htmlFor="soniox_voice_id">
            {voiceOptions.length > 1 ? (
              <SettingsSelect
                id="soniox_voice_id"
                label="Phone voice profile"
                value={sonioxVoiceId}
                onChange={setSonioxVoiceId}
                options={voiceOptions.map((voice) => ({
                  id: voice.id,
                  label: displaySonioxVoiceLabel("", voice.id, voiceOptions),
                }))}
              />
            ) : (
              <p className="text-sm text-ink-soft">
                {voiceOptions[0]?.description || "No voices loaded."}
              </p>
            )}
          </SettingsRow>
          <SettingsRow label="Voice label" htmlFor="soniox_voice_label">
            <input
              id="soniox_voice_label"
              type="text"
              maxLength={40}
              value={sonioxVoiceLabel}
              onChange={(e) => setSonioxVoiceLabel(e.target.value)}
              placeholder="Shop voice"
              className={denseFieldClass}
            />
          </SettingsRow>
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2">
            <p className="text-sm text-ink-soft">
              {sonioxVoiceLabel.trim() || sonioxVoiceId
                ? displaySonioxVoiceLabel(
                    sonioxVoiceLabel,
                    sonioxVoiceId,
                    voiceOptions
                  )
                : "No voice selected"}
            </p>
            <button
              type="button"
              onClick={() => void generateVoiceSample()}
              disabled={voiceSampleLoading}
              className={settingsGhostButtonClass}
            >
              {voiceSampleLoading ? "Generating…" : "Hear sample"}
            </button>
          </div>
          {voiceSampleUrl ? (
            <div className="px-4 py-2">
              <audio
                controls
                preload="metadata"
                className="max-w-full"
                onError={() => {
                  URL.revokeObjectURL(voiceSampleUrl);
                  setVoiceSampleUrl(null);
                  setVoiceSampleError(NO_VOICE_SAMPLE_COPY);
                }}
              >
                <source src={voiceSampleUrl} type="audio/wav" />
              </audio>
            </div>
          ) : voiceSampleError ? (
            <p className="px-4 py-2 text-xs text-warn" role="alert" data-testid="voice-sample-empty">
              {voiceSampleError}
            </p>
          ) : null}
        </SettingsGroup>
        <SettingsGroup title="Tools">
          {AGENT_TOOL_OPTIONS.map((opt) => {
            const on = agentTools[opt.id];
            return (
              <SettingsRow
                key={opt.id}
                label={opt.label}
                hint={on ? opt.onLabel : opt.offLabel}
                control="switch"
              >
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
              </SettingsRow>
            );
          })}
        </SettingsGroup>
      </section>

<section
        className={panel === "pronunciation" ? "space-y-4" : "hidden"}
      >
        {panel === "pronunciation" ? (
          <PronunciationCoach
            tenantId={tenant.id}
            businessName={businessName}
            agentName={agentName}
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
            voiceId={tenant.soniox_voice_id ?? null}
            omitLexiconField
          />
        ) : null}
      </section>

      <section className={panel === "team" ? "space-y-4" : "hidden"}>
        {liveTransferExecutor || handoffMode === "live_transfer" ? (
          <SettingsGroup>
            <SettingsRow label="Live connect" control="switch">
              <ToolSwitch
                checked={handoffMode === "live_transfer"}
                label="Live connect"
                onChange={(next) =>
                  setHandoffMode(next ? "live_transfer" : "callback")
                }
              />
            </SettingsRow>
          </SettingsGroup>
        ) : null}
        <p className="px-1 text-xs text-ink-soft">{liveConnectBlurb(liveDest?.name)}</p>

        <div className="space-y-1">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <p className={settingsBlockTitleClass}>People</p>
            <button
              type="button"
              onClick={() => setTeam((prev) => [...prev, emptyMember()])}
              className={settingsGhostButtonClass}
            >
              Add person
            </button>
          </div>
          <p id="team-notify-channels" className="px-1 text-xs text-ink-soft">
            {TEAM_NOTIFY_CHANNEL_NOTE}
          </p>
        </div>

        <div className="overflow-hidden rounded-xl border border-line">
          <div className="hidden lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto_2.5rem] lg:items-center lg:gap-x-3 border-b border-line bg-surface-canvas px-3 py-2 text-xs font-medium uppercase tracking-wide text-ink-soft">
            <span>Name</span>
            <span>Handles</span>
            <span>Phone</span>
            <span>Email</span>
            <span className="grid w-[15rem] grid-cols-3 gap-1 text-center text-caption font-medium normal-case tracking-normal">
              {TEAM_NOTIFY_FLAGS.map((flag) => (
                <span key={flag.key} title={TEAM_NOTIFY_CHANNEL_NOTE}>
                  {flag.label}
                </span>
              ))}
            </span>
            <span className="sr-only">Remove</span>
          </div>
          {team.map((member, index) => (
            <div
              key={`team-${index}`}
              className="grid grid-cols-1 gap-3 border-b border-line px-3 py-3 last:border-b-0 md:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto_2.5rem] lg:items-start lg:gap-x-3 lg:py-2"
            >
              <div className="min-w-0 truncate">
                <label className="block text-xs font-medium text-ink-soft lg:sr-only" htmlFor={`team-name-${index}`}>
                  Name
                </label>
                <input
                  id={`team-name-${index}`}
                  value={member.name}
                  onChange={(e) => updateTeam(index, "name", e.target.value)}
                  placeholder="Wanjiku Mwangi"
                  className={`${denseFieldClass} mt-1 min-w-0 truncate lg:mt-0`}
                />
              </div>
              <div className="min-w-0">
                <label className="block text-xs font-medium text-ink-soft lg:sr-only" htmlFor={`team-role-${index}`}>
                  Handles
                </label>
                <input
                  id={`team-role-${index}`}
                  value={member.role}
                  onChange={(e) => updateTeam(index, "role", e.target.value)}
                  placeholder="Orders and payments"
                  className={`${denseFieldClass} mt-1 lg:mt-0`}
                />
              </div>
              <div className="min-w-0">
                <label className="block text-xs font-medium text-ink-soft lg:sr-only" htmlFor={`team-phone-${index}`}>
                  Phone
                </label>
                <input
                  id={`team-phone-${index}`}
                  value={member.phone}
                  onChange={(e) => updateTeam(index, "phone", e.target.value)}
                  placeholder="+254 700 000 000"
                  className={`${denseFieldClass} mt-1 lg:mt-0`}
                />
              </div>
              <div className="min-w-0 truncate">
                <label className="block text-xs font-medium text-ink-soft lg:sr-only" htmlFor={`team-email-${index}`}>
                  Email
                </label>
                <input
                  id={`team-email-${index}`}
                  type="email"
                  value={member.email || ""}
                  onChange={(e) => updateTeam(index, "email", e.target.value)}
                  placeholder="wanjiku@shop.co.ke"
                  className={`${denseFieldClass} mt-1 min-w-0 truncate lg:mt-0`}
                />
              </div>
              <div
                className="grid w-[15rem] grid-cols-3 gap-1"
                role="group"
                aria-label={`Notify for ${member.name || `teammate ${index + 1}`}`}
                aria-describedby="team-notify-channels"
              >
                {TEAM_NOTIFY_FLAGS.map((flag) => {
                  const selected = member[flag.key] === true;
                  return (
                    <div key={flag.key} className="flex min-h-11 flex-col items-center justify-center">
                      <span className="text-xs font-medium text-ink-soft lg:sr-only" title={TEAM_NOTIFY_CHANNEL_NOTE}>
                        {flag.label}
                      </span>
                      <ToolSwitch
                        checked={selected}
                        label={`${flag.label} for ${member.name || `teammate ${index + 1}`}`}
                        hint={TEAM_NOTIFY_CHANNEL_NOTE}
                        onChange={(next) => updateTeam(index, flag.key, next)}
                      />
                    </div>
                  );
                })}
              </div>
              <div className="flex items-start justify-end lg:pt-1">
                <button
                  type="button"
                  onClick={() =>
                    setTeam((prev) =>
                      prev.length <= 1 ? [emptyMember()] : prev.filter((_, i) => i !== index)
                    )
                  }
                  className={settingsTrashButtonClass}
                  aria-label={`Remove teammate ${index + 1}`}
                >
                  <TrashIcon className="h-4 w-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section
        id="golden-faqs"
        className={panel === "faqs" ? "space-y-3" : "hidden"}
      >
        <div className="flex flex-wrap items-end justify-between gap-2 px-1">
          <p className={settingsBlockTitleClass} aria-live="polite">
            FAQs
            <span className="ml-2 font-medium normal-case tracking-normal text-ink-soft">
              {filledFaqCount} of {FAQ_MAX}
            </span>
          </p>
          <button
            type="button"
            onClick={() => {
              setFaqs((prev) => [...prev, emptyFaq()]);
              setFaqPage(Math.floor(faqs.length / FAQ_PAGE_SIZE));
            }}
            disabled={faqs.length >= FAQ_MAX}
            className={`${settingsGhostButtonClass} disabled:opacity-60`}
          >
            Add FAQ
          </button>
        </div>

        {faqs.length > 0 ? (
        <div className="overflow-hidden rounded-xl border border-line">
          <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_2.75rem] items-center gap-x-3 border-b border-line bg-surface-canvas px-3 py-2 text-xs font-medium uppercase tracking-wide text-ink-soft">
            <span>Question</span>
            <span>Answer</span>
            <span className="sr-only">Remove</span>
          </div>
          {visibleFaqs.map((faq, localIndex) => {
            const index = safeFaqPage * FAQ_PAGE_SIZE + localIndex;
            return (
            <div
              key={`faq-${index}`}
              className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_2.75rem] items-start gap-x-3 border-b border-line px-3 py-2.5 last:border-b-0"
            >
              <div className="min-w-0">
                <label className="sr-only" htmlFor={`faq-q-${index}`}>
                  Question
                </label>
                <input
                  id={`faq-q-${index}`}
                  value={faq.question}
                  maxLength={FAQ_QUESTION_MAX}
                  onChange={(e) => updateFaq(index, "question", e.target.value)}
                  aria-invalid={faqDupIndexes.has(index) || undefined}
                  aria-describedby={
                    faqDupIndexes.has(index) ? `faq-dup-${index}` : undefined
                  }
                  className={`${fieldClass} py-2`}
                />
                {faqDupIndexes.has(index) ? (
                  <p id={`faq-dup-${index}`} className="mt-1 text-xs text-warn" role="status">
                    Same as another FAQ. Keep one clear wording.
                  </p>
                ) : null}
              </div>
              <div className="min-w-0">
                <label className="sr-only" htmlFor={`faq-a-${index}`}>
                  Answer
                </label>
                <textarea
                  id={`faq-a-${index}`}
                  value={faq.answer}
                  maxLength={FAQ_ANSWER_MAX}
                  onChange={(e) => updateFaq(index, "answer", e.target.value)}
                  rows={2}
                  className={`${fieldClass} py-2 leading-relaxed`}
                />
              </div>
              <div className="flex items-start justify-end">
                <button
                  type="button"
                  onClick={() =>
                    setFaqs((prev) => prev.filter((_, i) => i !== index))
                  }
                  className={settingsTrashButtonClass}
                  aria-label={`Remove FAQ ${index + 1}`}
                >
                  <TrashIcon className="h-4 w-4" />
                </button>
              </div>
            </div>
            );
          })}
          <CatalogPager
            page={safeFaqPage}
            pageSize={FAQ_PAGE_SIZE}
            total={faqs.length}
            noun="FAQ"
            onPage={setFaqPage}
          />
        </div>
        ) : null}
      </section>

        </div>
      </div>
    </form>
  );
}
