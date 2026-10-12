"use client";

import { AlertContactsList } from "@/components/AlertContactsList";

import { withRoleGate } from "@/components/DeskRole";
import { CharCount as KitCharCount, FieldCard, TextAreaField, TextField } from "@/components/ui/TextField";
import { POLICY_TEXT_MAX } from "@/lib/lengthLimits";
import { normalizeContactPhone } from "@/lib/teamValidation";
import { useActionState, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
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
  formatHoursForOwner,
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
  previewSuggestedProducts,
  previewSuggestedServices,
  suggestImportedProducts,
  suggestImportedServices,
} from "@/lib/catalogSuggest";
import { CatalogImportSheet } from "@/components/settings/catalog/CatalogImportSheet";
import { CatalogSectionShell } from "@/components/settings/catalog/CatalogSectionShell";
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
  clampFaq,
  normalizeFaqKey,
} from "@/lib/faqs";
import { SERVICES_PASTE_POOLS, placeholderPool } from "@/lib/deskPlaceholders";
import { useMountedPoolPick } from "@/lib/useMountedPoolPick";
import {
  parseVertical,
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
  upgradeLegacyPlace,
  normalizeBusinessLocations,
  type BusinessLocation,
} from "@/lib/businessLocations";
import {
  bookingModePatch,
  HOLD_HOURS_OPTIONS,
  holdRulesValue,
  normalizeBusinessPolicies,
  readBookingMode,
  readHoldRules,
  POLICY_FIELDS,
  type BusinessPolicies,
} from "@/lib/businessPolicies";
import { PlacesEditor } from "@/components/structured/PlacesEditor";
import { ServiceAreasEditor } from "@/components/structured/ServiceAreasEditor";
import { serviceAreasForForm, suggestHomeAreas, type ServiceAreas } from "@/lib/serviceAreas";
import { stableRowId } from "@/lib/factHash";
import { catalogBaseline, isUnpricedRow } from "@/lib/catalogPricing";
import { DeskSelect } from "@/components/ui/DeskSelect";
import { PaymentsEditor } from "@/components/structured/PaymentsEditor";
import { PolicyRulesEditor } from "@/components/structured/PolicyRulesEditor";
import dynamic from "next/dynamic";
// Pronunciation is one panel of many; load it only when that panel renders.
const PronunciationCoach = dynamic(() => import("@/components/PronunciationCoach").then((m) => m.PronunciationCoach));
import { ConfirmSheet } from "@/components/ui/ConfirmSheet";
import { notify } from "@/components/ui/DeskNotice";
import { useSettingsLeaveSource } from "@/components/SettingsLeaveGuard";
import { carrySavedRow, isSavedRow, markSavedRow } from "@/lib/savedRow";
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
  settingsBlockTitleClass,
  settingsConsoleClass,
  settingsFormBodyClass,
  settingsDenseFieldClass,
  settingsValueFieldClass,
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
    .map((row) => {
      if (!row || typeof row !== "object") return null;
      const next = clampFaq(row);
      if (!next.question && !next.answer) return null;
      return markSavedRow(next);
    })
    .filter((row): row is FaqEntry => Boolean(row));
}

const emptyMember = (): TeamDirectoryEntry => ({
  name: "",
  role: "",
  phone: "",
  email: "",
  ...EMPTY_TEAM_NOTIFY_FLAGS,
});

/** Permission kinds on the three saved notify flags. Channels stay on How we notify. */
const TEAM_NOTIFY_CHANNEL_NOTE = "Channels follow How we notify.";
const TEAM_NOTIFY_FLAGS: Array<{
  key: "receives_escalation" | "receives_inbox" | "receives_ops";
  label: string;
}> = [
  { key: "receives_escalation", label: "Urgent" },
  { key: "receives_inbox", label: "Follow-up" },
  { key: "receives_ops", label: "Ops" },
];
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

function placeLocationLine(loc: Pick<BusinessLocation, "label" | "address" | "landmark">): string {
  return [loc.label, loc.address, loc.landmark]
    .map((part) => part.trim())
    .filter(Boolean)
    .join(" · ");
}

const initial: SettingsCompileState = {};

/**
 * A dropped connection (TypeError: network error) must not throw the page into the error
 * boundary: the write has usually landed, so report it and let the form refetch.
 */
async function saveSettingsSafely(
  prev: SettingsCompileState,
  formData: FormData
): Promise<SettingsCompileState> {
  try {
    return await saveAndCompileSettings(prev, formData);
  } catch (err) {
    console.warn("[settings] save response lost:", err instanceof Error ? err.message : err);
    return { networkError: true };
  }
}

const tableFieldClass = settingsTableFieldClass;
const denseFieldClass = settingsDenseFieldClass;

const STOCK_OPTIONS = [
  { value: "yes", label: "In stock" },
  { value: "no", label: "Out of stock" },
  { value: "unknown", label: "Unknown" },
] as const;

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
    <div>
      <ExpandTextarea
        id={id}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        maxLength={POLICY_TEXT_MAX}
      />
      <CharCount value={value} max={POLICY_TEXT_MAX} />
    </div>
  );
}

function CharCount({ value, max }: { value: string; max: number }) {
  return (
    <div className="mt-1.5 flex justify-end">
      <KitCharCount length={value.length} max={max} />
    </div>
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
      className="border-t border-hairline bg-surface-canvas px-3 py-3"
    />
  );
}

function isOwnerTeamRow(phone: string, ownerPhone: string | null | undefined): boolean {
  const a = normalizeContactPhone(phone);
  return Boolean(a && a === normalizeContactPhone(ownerPhone));
}

function TenantFormInner({
  tenant,
  panel = "identity",
  curatedVoices,
  heading = null,
  sidebar = null,
  liveTransferExecutor = false,
  showBack = true,
  membersSlot = null,
  structuredSlot = null,
}: {
  tenant: TenantRow;
  panel?: SettingsPanel;
  curatedVoices?: CuratedSonioxVoice[];
  heading?: string | null;
  sidebar?: ReactNode;
  liveTransferExecutor?: boolean;
  showBack?: boolean;
  /** Team & access: Members section (feature flag TEAM_INVITES_ENABLED). */
  membersSlot?: ReactNode;
  /** Typed-data groups (payments, price checks, category) rendered by the server page per panel. */
  structuredSlot?: Partial<Record<"identity" | "catalog", ReactNode>> | null;
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
    return rows.length ? rows.map((row) => markSavedRow(row)) : [emptyService()];
  });
  const [products, setProducts] = useState<ProductItem[]>(() => {
    const rows = normalizeProductCatalog(tenant.product_catalog);
    return rows.length ? rows.map((row) => markSavedRow(row)) : [];
  });
  const [socialHandles, setSocialHandles] = useState<SocialHandles>(() => {
    const next = normalizeSocialHandles(tenant.social_handles);
    return { channels: next.channels.map((row) => markSavedRow(row)) };
  });
  const [bulkServicesText, setBulkServicesText] = useState("");
  const [bulkServicesError, setBulkServicesError] = useState<string | null>(null);
  const [servicesImportOpen, setServicesImportOpen] = useState(false);
  const [productsImportOpen, setProductsImportOpen] = useState(false);
  const [bulkProductsText, setBulkProductsText] = useState("");
  const [bulkProductsError, setBulkProductsError] = useState<string | null>(null);
  const [servicePage, setServicePage] = useState(0);
  const [productPage, setProductPage] = useState(0);
  const [unpricedOnly, setUnpricedOnly] = useState(false);
  useEffect(() => {
    // Read after mount so server and first client render agree.
    if (new URLSearchParams(window.location.search).get("filter") === "unpriced") setUnpricedOnly(true);
  }, []);
  const [faqPage, setFaqPage] = useState(0);
  const [unknownFallback, setUnknownFallback] = useState(
    tenant.unknown_answer_fallback || ""
  );
  const [agentName, setAgentName] = useState(tenant.agent_name || "");
  const [spokenName, setSpokenName] = useState(tenant.spoken_name || "");
  const [greetingInvite, setGreetingInvite] = useState(tenant.greeting_invite || "");
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
    const rows = normalizeBusinessLocations(tenant.business_locations).map(upgradeLegacyPlace);
    return rows.length ? rows.map((row) => markSavedRow(row)) : [emptyLocation()];
  });
  const [serviceAreas, setServiceAreas] = useState<ServiceAreas>(() =>
    serviceAreasForForm(tenant.service_areas, tenant.business_policies?.coverage_areas, tenant.vertical)
  );
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
    const rows = normalizeTeam(
      tenant.team_directory,
      tenant.whatsapp_notification_number
    );
    return rows.length ? rows.map((row) => markSavedRow(row)) : [emptyMember()];
  });
  const liveDest = firstDialableTeammate(team);
  const [faqs, setFaqs] = useState<FaqEntry[]>(() => normalizeFaqs(tenant.faqs));
  const [ownerPaths, setOwnerPaths] = useState<string[]>([]);
  const [ttsLexicon, setTtsLexicon] = useState<TtsLexiconEntry[]>(() =>
    parseTtsLexicon(tenant.tts_lexicon)
  );
  const router = useRouter();
  const [state, formAction, pending] = useActionState(saveSettingsSafely, initial);
  // Price text as loaded. The server keeps the stored (maybe just confirmed) price for any row
  // whose text the owner did not touch in this form.
  const [catalogBaseJson] = useState(() =>
    JSON.stringify({
      ...catalogBaseline(normalizeServicesCatalog(tenant.services_catalog) as unknown as Record<string, unknown>[], "service"),
      ...catalogBaseline(normalizeProductCatalog(tenant.product_catalog) as unknown as Record<string, unknown>[], "product"),
    })
  );

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
          .map((f) => clampFaq(f))
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
  // ?filter=unpriced (from the Overview "Add prices" row) shows only items with no price.
  // The set is frozen while you type (a row must not vanish on its first digit) and is
  // re-read only when rows are added or removed. Same "no price" rule as the count.
  const unpricedFrozen = useMemo(
    () =>
      unpricedOnly
        ? {
            services: services.flatMap((row, i) => (isUnpricedRow(row, "service") ? [i] : [])),
            products: products.flatMap((row, i) => (isUnpricedRow(row, "product") ? [i] : [])),
          }
        : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps -- frozen on purpose: lengths only, not text
    [unpricedOnly, services.length, products.length]
  );
  const serviceIdx = useMemo(
    () => unpricedFrozen?.services.filter((i) => i < services.length) ?? services.map((_, i) => i),
    [services, unpricedFrozen]
  );
  const productIdx = useMemo(
    () => unpricedFrozen?.products.filter((i) => i < products.length) ?? products.map((_, i) => i),
    [products, unpricedFrozen]
  );
  const servicePageCount = Math.max(1, Math.ceil(serviceIdx.length / SERVICE_PAGE_SIZE));
  const productPageCount = Math.max(1, Math.ceil(productIdx.length / PRODUCT_PAGE_SIZE));
  const faqPageCount = Math.max(1, Math.ceil(faqs.length / FAQ_PAGE_SIZE));
  const safeServicePage = Math.min(servicePage, servicePageCount - 1);
  const safeProductPage = Math.min(productPage, productPageCount - 1);
  const safeFaqPage = Math.min(faqPage, faqPageCount - 1);
  const visibleServices = serviceIdx
    .slice(safeServicePage * SERVICE_PAGE_SIZE, safeServicePage * SERVICE_PAGE_SIZE + SERVICE_PAGE_SIZE)
    .map((i) => services[i]);
  const visibleProducts = productIdx
    .slice(safeProductPage * PRODUCT_PAGE_SIZE, safeProductPage * PRODUCT_PAGE_SIZE + PRODUCT_PAGE_SIZE)
    .map((i) => products[i]);
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
    // Compile finished before ok - owners should hear the line was trained, not only "Saved".
    if (state.ok) notify("Saved · training line");
    if (state.networkError) {
      notify("Connection dropped. Showing your latest saved details.");
      router.refresh();
    }
  }, [state, router]);

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
      prev.map((row, i) =>
        i === index ? carrySavedRow({ ...row, [key]: value }, row) : row
      )
    );
  }

  function queueOwnerPath(path: string) {
    setOwnerPaths((prev) => (prev.includes(path) ? prev : [...prev, path]));
  }

  function updateFaq(index: number, key: keyof FaqEntry, value: string) {
    const current = faqs[index];
    if (
      current &&
      (key === "question" || key === "answer") &&
      current[key] !== value
    ) {
      queueOwnerPath(`faqs.${index + 1}`);
    }
    setFaqs((prev) =>
      prev.map((row, i) => {
        if (i !== index) return row;
        if (key !== "question" && key !== "answer") {
          return carrySavedRow({ ...row, [key]: value }, row);
        }
        if (row[key] === value) return row;
        const keepGolden = row.source === "owner" && row.status === "golden";
        return carrySavedRow(
          {
            ...row,
            [key]: value,
            source: "owner",
            status: keepGolden ? "golden" : "confirmed",
            confirmed: true,
          },
          row
        );
      })
    );
  }

  function updateService(index: number, key: keyof ServiceItem, value: string) {
    const current = services[index];
    if (current && String(current[key] ?? "") !== value && current.name.trim()) {
      queueOwnerPath(`catalog.service.${stableRowId(current) || String(index + 1)}.name`);
    }
    setServices((prev) =>
      prev.map((row, i) =>
        i === index ? carrySavedRow({ ...row, [key]: value, source: "owner" }, row) : row
      )
    );
  }

  function updateProduct(index: number, key: keyof ProductItem, value: string) {
    const current = products[index];
    if (current && String(current[key] ?? "") !== value && current.name.trim()) {
      const sku = current.sku.trim() || String(index + 1);
      queueOwnerPath(`catalog.product.${sku}.name`);
    }
    setProducts((prev) =>
      prev.map((row, i) => {
        if (i !== index) return row;
        if (key === "aliases") {
          return carrySavedRow(
            {
              ...row,
              source: "owner",
              aliases: value
                .split(/[,;|]/)
                .map((a) => a.trim())
                .filter(Boolean)
                .slice(0, 8),
            },
            row
          );
        }
        return carrySavedRow({ ...row, [key]: value, source: "owner" }, row);
      })
    );
  }

  function setProductHoldable(index: number, holdable: boolean) {
    const current = products[index];
    if (current && current.name.trim()) {
      queueOwnerPath(`catalog.product.${current.sku.trim() || String(index + 1)}.name`);
    }
    setProducts((prev) =>
      prev.map((row, i) => (i === index ? carrySavedRow({ ...row, holdable, source: "owner" }, row) : row))
    );
  }

  function updateSocialChannel(
    index: number,
    key: keyof SocialChannel,
    value: string
  ) {
    setSocialHandles((prev) => ({
      channels: prev.channels.map((row, i) =>
        i === index ? carrySavedRow({ ...row, [key]: value }, row) : row
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

  const bulkPreview = useMemo(
    () => previewSuggestedServices(parseBulkServices(bulkServicesText), vertical),
    [bulkServicesText, vertical]
  );
  const bulkProductPreview = useMemo(
    () => previewSuggestedProducts(parseBulkProducts(bulkProductsText)),
    [bulkProductsText]
  );

  // Warn before leaving only while a save is actually in flight.
  useEffect(() => {
    if (!pending) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [pending]);

  // Locations drawers ("Save 3 areas", "Done") save the page straight away.
  const saveAfterLocationsRef = useRef(false);
  useEffect(() => {
    if (!saveAfterLocationsRef.current) return;
    saveAfterLocationsRef.current = false;
    const form = document.getElementById(TENANT_SETTINGS_FORM_ID);
    if (form instanceof HTMLFormElement) form.requestSubmit();
  }, [serviceAreas, locations]);

  // A pasted list is saved straight away (the sheet says "Add and save"), not left pending.
  const saveAfterPasteRef = useRef(false);
  useEffect(() => {
    if (!saveAfterPasteRef.current) return;
    saveAfterPasteRef.current = false;
    const form = document.getElementById(TENANT_SETTINGS_FORM_ID);
    if (form instanceof HTMLFormElement) form.requestSubmit();
  }, [services, products]);

  function applyBulkServices() {
    const parsed = suggestImportedServices(parseBulkServices(bulkServicesText), vertical);
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
    saveAfterPasteRef.current = true;
    setBulkServicesText("");
    setBulkServicesError(null);
  }

  function applyBulkProducts() {
    const parsed = suggestImportedProducts(parseBulkProducts(bulkProductsText));
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
    saveAfterPasteRef.current = true;
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
  const draftKey = [
    businessName,
    servicesOfferedSummary,
    servicesJson,
    productsJson,
    socialJson,
    servicesNotes,
    businessHoursSummary,
    hoursScheduleJson,
    locationNotesField,
    afterHoursMode,
    vertical,
    handoffMode,
    locationsJson,
    policiesJson,
    agentName,
    spokenName,
    greetingInvite,
    tone,
    unknownFallback,
    teamJson,
    faqsJson,
    agentTools.escalate ? "1" : "0",
    agentTools.end_call ? "1" : "0",
    sonioxVoiceId,
    sonioxVoiceLabel,
    ttsLexiconJson,
  ].join("\u0001");
  const [baseline, setBaseline] = useState(draftKey);
  const formDirty = draftKey !== baseline;
  const savedStateRef = useRef(state);
  useEffect(() => {
    if (!state.ok || savedStateRef.current === state) return;
    savedStateRef.current = state;
    setBaseline(draftKey);
  }, [state, draftKey]);
  useSettingsLeaveSource("form", formDirty);
  const [removeAsk, setRemoveAsk] = useState<{
    title: string;
    body: string;
    run: () => void;
  } | null>(null);
  const removeHeld = useRef(removeAsk);
  if (removeAsk) removeHeld.current = removeAsk;
  const removeView = removeAsk ?? removeHeld.current;

  function requestRemove(row: object, title: string, body: string, run: () => void) {
    if (!isSavedRow(row)) {
      run();
      return;
    }
    setRemoveAsk({ title, body, run });
  }

  return (
    <form
      id={TENANT_SETTINGS_FORM_ID}
      action={formAction}
      onSubmit={(event) => {
        // Pronunciation saves live via its own actions. Enter inside the coach
        // must not post this form (feels like a full Settings reload).
        if (panel === "pronunciation") event.preventDefault();
      }}
    >
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
              panel === "pronunciation" ? (
                <p className="max-w-[11rem] text-right text-meta leading-snug text-ink-2">
                  Saves live - no sticky Save
                </p>
              ) : (
                <TenantSettingsSaveButton pending={pending} />
              )
            }
          />

      <div className={`${settingsFormBodyClass} space-y-4`}>
      <input type="hidden" name="id" value={tenant.id} />
      <input type="hidden" name="settings_scope" value={panel} />
      <input type="hidden" name="business_name" value={businessName} />
      <input type="hidden" name="services_offered" value={servicesOfferedSummary} />
      <input type="hidden" name="services_catalog" value={servicesJson} />
      <input type="hidden" name="product_catalog" value={productsJson} />
      <input type="hidden" name="catalog_baseline" value={catalogBaseJson} />
      <input type="hidden" name="social_handles" value={socialJson} />
      <input type="hidden" name="services_notes" value={servicesNotes} />
      <input type="hidden" name="business_hours" value={businessHoursSummary} />
      <input type="hidden" name="hours_schedule" value={hoursScheduleJson} />
      <input type="hidden" name="location_notes" value={locationNotesField} />
      <input type="hidden" name="after_hours_mode" value={afterHoursMode} />
      <input type="hidden" name="vertical" value={vertical} />
      <input type="hidden" name="handoff_mode" value={handoffMode} />
      <input type="hidden" name="business_locations" value={locationsJson} />
      <input type="hidden" name="service_areas" value={JSON.stringify(serviceAreas)} />
      <input type="hidden" name="business_policies" value={policiesJson} />
      <input type="hidden" name="agent_name" value={agentName} />
      <input type="hidden" name="spoken_name" value={spokenName} />
      <input type="hidden" name="greeting_invite" value={greetingInvite} />
      <input type="hidden" name="agent_tone" value={tone} />
      <input type="hidden" name="unknown_answer_fallback" value={unknownFallback} />
      <input type="hidden" name="team_directory" value={teamJson} />
      <input type="hidden" name="faqs" value={faqsJson} />
      <input type="hidden" name="owner_field_paths" value={JSON.stringify(ownerPaths)} />
      <input type="hidden" name="tool_escalate" value={agentTools.escalate ? "1" : "0"} />
      <input type="hidden" name="tool_end_call" value={agentTools.end_call ? "1" : "0"} />
      <input type="hidden" name="soniox_voice_id" value={sonioxVoiceId} />
      <input type="hidden" name="soniox_voice_label" value={sonioxVoiceLabel} />
      <input type="hidden" name="tts_lexicon" value={ttsLexiconJson} />

      <section className={panel === "identity" ? "space-y-3" : "hidden"}>
        {panel === "identity" ? structuredSlot?.identity : null}
        <SettingsGroup title="Business Assistant">
          <SettingsRow label="Assistant name" htmlFor="agent_name">
            <input
              id="agent_name"
              value={agentName}
              onChange={(e) => setAgentName(e.target.value)}
              placeholder="Aisha"
              maxLength={40}
              className={settingsValueFieldClass}
            />
          </SettingsRow>
          <SettingsSelect
            id="agent_tone"
            label="Tone"
            value={tone}
            placeholder="Tone"
            onChange={(id) => setTone(id)}
            options={TONE_OPTIONS.map((opt) => ({
              id: opt.id,
              label: TONE_LABELS[opt.id],
              detail: opt.blurb,
            }))}
          />
        </SettingsGroup>

        <SettingsGroup title="Business">
          <SettingsRow label="Business name" htmlFor="business_name">
            <input
              id="business_name"
              value={businessName}
              onChange={(e) => setBusinessName(e.target.value)}
              placeholder="Westlands Books"
              title={businessName || undefined}
              className={settingsValueFieldClass}
            />
          </SettingsRow>
          <SettingsRow
            label="Spoken name"
            htmlFor="spoken_name"
            hint="What callers hear"
          >
            <input
              id="spoken_name"
              value={spokenName}
              onChange={(e) => setSpokenName(e.target.value)}
              placeholder="Done and Dusted"
              maxLength={40}
              title={spokenName || undefined}
              className={settingsValueFieldClass}
            />
          </SettingsRow>
          <SettingsRow
            label="Short invite"
            htmlFor="greeting_invite"
            hint="The line after the name"
          >
            <input
              id="greeting_invite"
              value={greetingInvite}
              onChange={(e) => setGreetingInvite(e.target.value)}
              placeholder="How can I help?"
              maxLength={80}
              className={settingsValueFieldClass}
            />
          </SettingsRow>
          <SettingsSelect
            id="business_vertical"
            label="Business type"
            value={vertical}
            onChange={setVertical}
            options={verticalSettingsOptions(vertical).map((opt) => ({
              id: opt.id,
              label: opt.label,
              detail: opt.blurb,
            }))}
          />
        </SettingsGroup>

        <SettingsGroup
          title="Public contacts"
          action={
            socialHandles.channels.length > 0 ? (
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
            ) : undefined
          }
        >
          {socialHandles.channels.length === 0 ? (
            <div className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
              <p className="text-body text-ink-2">No public contacts yet</p>
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
          ) : (
            <div className="min-w-0">
            <div className="divide-y divide-hairline lg:hidden">
              {socialHandles.channels.map((channel, index) => (
                <div
                  key={`social-m-${index}`}
                  className="grid grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)_2.75rem] items-center gap-2 px-3 py-2"
                >
                  <div className="min-w-0">
                    <label className="sr-only" htmlFor={`social-kind-m-${index}`}>
                      Type
                    </label>
                    <DeskSelect
                      id={`social-kind-m-${index}`}
                      aria-label="Type"
                      value={channel.kind}
                      className={denseFieldClass}
                      options={SOCIAL_CHANNEL_KINDS.map((k) => ({
                        value: k.id,
                        label: k.label,
                      }))}
                      onChange={(next) => updateSocialChannel(index, "kind", next)}
                    />
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
                    onClick={() =>
                      requestRemove(
                        channel,
                        "Remove this contact?",
                        "It leaves the public contacts when you save.",
                        () => removeSocialChannel(index)
                      )
                    }
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
            <div className="hidden lg:block">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[520px] text-body">
                  <thead>
                    <tr className="border-b border-hairline bg-surface-canvas text-left text-meta font-medium text-ink-2">
                      <th className="px-3 py-2 font-medium w-36">Type</th>
                      <th className="px-3 py-2 font-medium w-28">Label</th>
                      <th className="px-3 py-2 font-medium">Handle / URL</th>
                      <th className="px-3 py-2 font-medium w-12">
                        <span className="sr-only">Action</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-hairline bg-surface">
                    {socialHandles.channels.map((channel, index) => (
                      <tr key={`social-ch-${index}`} className="align-middle">
                        <td className="px-3 py-1.5">
                          <label className="sr-only" htmlFor={`social-kind-${index}`}>
                            Type
                          </label>
                          <DeskSelect
                            id={`social-kind-${index}`}
                            aria-label="Type"
                            value={channel.kind}
                            className={denseFieldClass}
                            options={SOCIAL_CHANNEL_KINDS.map((k) => ({
                              value: k.id,
                              label: k.label,
                            }))}
                            onChange={(next) =>
                              updateSocialChannel(index, "kind", next)
                            }
                          />
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
                            onClick={() =>
                              requestRemove(
                                channel,
                                "Remove this contact?",
                                "It leaves the public contacts when you save.",
                                () => removeSocialChannel(index)
                              )
                            }
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
            </div>
          )}
        </SettingsGroup>
      </section>

      <section className={panel === "catalog" ? "space-y-4" : "hidden"}>
        {panel === "catalog" ? structuredSlot?.catalog : null}
        <CatalogSectionShell
          vertical={vertical}
          title="Catalogue"
          emptyTitle="No services yet"
          isEmpty={false}
        >
        <div className="space-y-3">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <p className={settingsBlockTitleClass}>Services</p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setServicesImportOpen(true)}
                className={settingsGhostButtonClass}
              >
                Paste list
              </button>
              <button
                type="button"
                onClick={() => {
                  setServices((prev) => [...prev, emptyService()]);
                  setServicePage(Math.floor(serviceIdx.length / SERVICE_PAGE_SIZE));
                }}
                className={settingsGhostButtonClass}
              >
                Add service
              </button>
            </div>
          </div>

          <CatalogImportSheet
            open={servicesImportOpen}
            onOpenChange={setServicesImportOpen}
            title="Paste services"
            description="One line per service. We suggest cleaner names before you add."
            placeholder={servicesPasteExample}
            text={bulkServicesText}
            onTextChange={(value) => {
              setBulkServicesText(value);
              if (bulkServicesError) setBulkServicesError(null);
            }}
            previewRows={bulkPreview}
            onApply={applyBulkServices}
            applyLabel="Add and save"
          />
          {bulkServicesError ? (
            <p className="text-body text-warn" role="alert">
              {bulkServicesError}
            </p>
          ) : null}

          <div className="divide-y divide-hairline overflow-hidden rounded-xl border border-hairline lg:hidden">
            {visibleServices.map((service, localIndex) => {
              const index = serviceIdx[safeServicePage * SERVICE_PAGE_SIZE + localIndex];
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
                      requestRemove(
                        service,
                        `Remove ${service.name.trim() || "this service"}?`,
                        "It leaves the catalogue when you save.",
                        () =>
                          setServices((prev) =>
                            prev.length <= 1
                              ? [emptyService()]
                              : prev.filter((_, i) => i !== index)
                          )
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
              total={serviceIdx.length}
              noun="service"
              onPage={setServicePage}
            />
          </div>

          <div className="hidden overflow-hidden rounded-xl border border-hairline lg:block">
            <div className="overflow-x-auto">
              <table className="w-full table-fixed text-body">
                <thead>
                  <tr className="border-b border-hairline bg-surface-canvas text-left text-meta font-medium text-ink-2">
                    <th className="min-w-0 px-3 py-2.5 font-medium">Name</th>
                    <th className="px-3 py-2.5 font-medium">Price</th>
                    <th className="px-3 py-2.5 font-medium">Notes</th>
                    <th className="px-3 py-2.5 font-medium">Out of scope</th>
                    <th className="px-3 py-2.5 font-medium w-16">
                      <span className="sr-only">Action</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-hairline bg-surface">
                  {visibleServices.map((service, localIndex) => {
                    const index = serviceIdx[safeServicePage * SERVICE_PAGE_SIZE + localIndex];
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
                              requestRemove(
                                service,
                                `Remove ${service.name.trim() || "this service"}?`,
                                "It leaves the catalogue when you save.",
                                () =>
                                  setServices((prev) =>
                                    prev.length <= 1
                                      ? [emptyService()]
                                      : prev.filter((_, i) => i !== index)
                                  )
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
              total={serviceIdx.length}
              noun="service"
              onPage={setServicePage}
            />
          </div>

          <div>
            <label className="block text-meta font-medium text-ink-2" htmlFor="services_notes">
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
                onClick={() => setProductsImportOpen(true)}
                className={settingsGhostButtonClass}
              >
                Paste list
              </button>
              <button
                type="button"
                onClick={() => {
                  setProducts((prev) => [...prev, emptyProduct()]);
                  setProductPage(Math.floor(productIdx.length / PRODUCT_PAGE_SIZE));
                }}
                className={settingsGhostButtonClass}
              >
                Add product
              </button>
            </div>
          </div>

          <CatalogImportSheet
            open={productsImportOpen}
            onOpenChange={setProductsImportOpen}
            title="Paste products"
            description="CSV or one name per line. We suggest cleaner titles before you add."
            placeholder={
              "name,price,category,in_stock\nAtomic Habits,2500 KES,Self-help,yes\n\nOr:\nAtomic Habits - 2,500 KES"
            }
            text={bulkProductsText}
            onTextChange={(value) => {
              setBulkProductsText(value);
              if (bulkProductsError) setBulkProductsError(null);
            }}
            previewRows={bulkProductPreview}
            onApply={applyBulkProducts}
            applyLabel="Add and save"
          />
          {bulkProductsError ? (
            <p className="text-body text-warn" role="alert">
              {bulkProductsError}
            </p>
          ) : null}

          {unpricedOnly ? (
            <div data-unpriced-filter="" className="flex min-h-11 items-center justify-between gap-3 rounded-xl bg-accent-tonal px-4 py-2">
              <p className="text-meta text-ink">
                Showing {productIdx.length + serviceIdx.length} without a price. Add one, or choose Ask so callers get a call back.
              </p>
              <button
                type="button"
                onClick={() => setUnpricedOnly(false)}
                className="inline-flex min-h-11 shrink-0 items-center text-meta font-medium text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
              >
                Show all
              </button>
            </div>
          ) : null}
          {products.length === 0 ? null : (
            <>
            <p id="holdable" className="scroll-mt-24 px-1 text-meta text-ink-2">
              Turn on Hold for items your Business Assistant may hold for a caller.
            </p>
            <div className="divide-y divide-hairline overflow-hidden rounded-xl border border-hairline lg:hidden">
              {visibleProducts.map((product, localIndex) => {
                const index = productIdx[safeProductPage * PRODUCT_PAGE_SIZE + localIndex];
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
                    <button
                      type="button"
                      onClick={() =>
                        requestRemove(
                          product,
                          `Remove ${product.name.trim() || "this product"}?`,
                          "It leaves the catalogue when you save.",
                          () => setProducts((prev) => prev.filter((_, i) => i !== index))
                        )
                      }
                      className={settingsTrashButtonClass}
                      aria-label={`Remove product ${index + 1}`}
                    >
                      <TrashIcon className="h-4 w-4" />
                    </button>
                    <div className="min-w-0">
                      <label className="sr-only" htmlFor={`prod-cat-m-${index}`}>Category</label>
                      <input id={`prod-cat-m-${index}`} value={product.category} onChange={(e) => updateProduct(index, "category", e.target.value)} placeholder="Self-help" className={denseFieldClass} />
                    </div>
                    <div className="col-span-2 min-w-0">
                      <label className="sr-only" htmlFor={`prod-stock-m-${index}`}>Stock</label>
                      <DeskSelect
                        id={`prod-stock-m-${index}`}
                        aria-label="Stock"
                        value={
                          product.in_stock === "yes" ||
                          product.in_stock === "no" ||
                          product.in_stock === "unknown"
                            ? product.in_stock
                            : ""
                        }
                        placeholder="Not set"
                        className={denseFieldClass}
                        options={STOCK_OPTIONS}
                        onChange={(next) => updateProduct(index, "in_stock", next)}
                      />
                    </div>
                    <div className="col-span-3 flex min-h-11 items-center justify-between gap-3">
                      <span className="text-meta text-ink-2">Hold</span>
                      <ToolSwitch
                        checked={product.holdable === true}
                        label={`Can hold ${product.name.trim() || `product ${index + 1}`}`}
                        onChange={(next) => setProductHoldable(index, next)}
                      />
                    </div>
                  </div>
                );
              })}
              <CatalogPager
                page={safeProductPage}
                pageSize={PRODUCT_PAGE_SIZE}
                total={productIdx.length}
                noun="product"
                onPage={setProductPage}
              />
            </div>
            <div className="hidden overflow-hidden rounded-xl border border-hairline lg:block">
              <div className="overflow-x-auto">
                <table className="w-full table-fixed text-body">
                  <thead>
                    <tr className="border-b border-hairline bg-surface-canvas text-left text-meta font-medium text-ink-2">
                      <th className="min-w-0 px-3 py-2.5 font-medium">Name</th>
                      <th className="px-3 py-2.5 font-medium">Price</th>
                      <th className="px-3 py-2.5 font-medium">Category</th>
                      <th className="px-3 py-2.5 font-medium">Stock</th>
                      <th className="px-3 py-2.5 font-medium w-12">
                        <span className="sr-only">Remove</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-hairline bg-surface">
                    {visibleProducts.map((product, localIndex) => {
                      const index = productIdx[safeProductPage * PRODUCT_PAGE_SIZE + localIndex];
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
                            <DeskSelect
                              id={`prod-stock-${index}`}
                              aria-label="Stock status"
                              value={
                                product.in_stock === "yes" ||
                                product.in_stock === "no" ||
                                product.in_stock === "unknown"
                                  ? product.in_stock
                                  : ""
                              }
                              placeholder="Not set"
                              className={tableFieldClass}
                              options={STOCK_OPTIONS}
                              onChange={(next) =>
                                updateProduct(index, "in_stock", next)
                              }
                            />
                            <span className="mt-1 flex items-center justify-between gap-2 text-meta text-ink-2">
                              Hold
                              <ToolSwitch
                                checked={product.holdable === true}
                                label={`Can hold ${product.name.trim() || `product ${index + 1}`}`}
                                onChange={(next) => setProductHoldable(index, next)}
                              />
                            </span>
                          </td>
                          <td className="px-2 py-2">
                            <button
                              type="button"
                              onClick={() =>
                                requestRemove(
                                  product,
                                  `Remove ${product.name.trim() || "this product"}?`,
                                  "It leaves the catalogue when you save.",
                                  () => setProducts((prev) => prev.filter((_, i) => i !== index))
                                )
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
                total={productIdx.length}
                noun="product"
                onPage={setProductPage}
              />
            </div>
            </>
          )}
        </div>
        )}
        </CatalogSectionShell>
      </section>

      <section className={panel === "hours" ? "space-y-6" : "hidden"}>
        <SettingsGroup title="Hours">
          <div className="hidden bg-surface-canvas px-3 py-2 text-meta font-medium text-ink-2 lg:grid lg:grid-cols-[minmax(5.5rem,7rem)_3.5rem_minmax(0,1fr)_minmax(0,1fr)] lg:items-center lg:gap-x-3">
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
                  <span className="min-w-0 truncate text-body font-medium text-ink">
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
                        className="block text-meta font-medium text-ink-2"
                        htmlFor={`open-m-${day}`}
                      >
                        Opens
                      </label>
                      <input
                        id={`open-m-${day}`}
                        type="time"
                        value={slot.open}
                        onChange={(e) => setDayTime(day, "open", e.target.value)}
                        className="mt-1 min-h-11 min-w-0 w-full rounded-lg border border-hairline bg-surface px-2 py-1.5 text-body text-ink outline-none placeholder:text-ink-2/70 focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent"
                      />
                    </div>
                    <div className="min-w-0">
                      <label
                        className="block text-meta font-medium text-ink-2"
                        htmlFor={`close-m-${day}`}
                      >
                        Closes
                      </label>
                      <input
                        id={`close-m-${day}`}
                        type="time"
                        value={slot.close}
                        onChange={(e) => setDayTime(day, "close", e.target.value)}
                        className="mt-1 min-h-11 min-w-0 w-full rounded-lg border border-hairline bg-surface px-2 py-1.5 text-body text-ink outline-none placeholder:text-ink-2/70 focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent"
                      />
                    </div>
                  </div>
                ) : null}
                <div className="hidden lg:grid lg:grid-cols-[minmax(5.5rem,7rem)_3.5rem_minmax(0,1fr)_minmax(0,1fr)] lg:items-center lg:gap-x-3">
                  <span className="min-w-0 truncate text-body font-medium text-ink">
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
                        className="min-h-11 min-w-0 w-full rounded-lg border border-hairline bg-surface px-2 py-1.5 text-body text-ink outline-none placeholder:text-ink-2/70 focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent"
                      />
                      <label className="sr-only" htmlFor={`close-${day}`}>
                        Closes
                      </label>
                      <input
                        id={`close-${day}`}
                        type="time"
                        value={slot.close}
                        onChange={(e) => setDayTime(day, "close", e.target.value)}
                        className="min-h-11 min-w-0 w-full rounded-lg border border-hairline bg-surface px-2 py-1.5 text-body text-ink outline-none placeholder:text-ink-2/70 focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent"
                      />
                    </>
                  ) : (
                    <span className="col-span-2 text-meta text-ink-2">Closed</span>
                  )}
                </div>
              </div>
            );
          })}
        </SettingsGroup>
      </section>

      <section
        className={panel === "locations" ? "space-y-3" : "hidden"}
      >
        <ServiceAreasEditor
          value={serviceAreas}
          vertical={vertical}
          homeAreas={[
            ...locations.map((l) => l.area_id || "").filter(Boolean),
            ...suggestHomeAreas(locations.map((l) => l.address).join(", ")),
          ]}
          onChange={setServiceAreas}
          onSave={(next) => {
            setServiceAreas(next);
            saveAfterLocationsRef.current = true;
          }}
        />
        <PlacesEditor
          value={locations}
          title={serviceAreas.no_premises ? "Your base (optional)" : locations.length > 1 ? "Branches" : "Your places"}
          hint={
            serviceAreas.no_premises
              ? "For reference only. Callers are not sent here."
              : locations.length > 1
                ? "Your Business Assistant sends callers to the nearest branch."
                : undefined
          }
          businessHours={formatHoursForOwner(hoursSchedule)}
          onSave={(rows) => {
            setLocations(rows);
            const first = rows[0];
            setLocationNotes(first ? placeLocationLine(first) : "");
            saveAfterLocationsRef.current = true;
          }}
        />
      </section>

      <section
        className={panel === "policies" ? "space-y-6" : "hidden"}
      >
        {panel === "policies" ? (
          <PaymentsEditor
            value={policies.payments ?? null}
            legacyText={policies.payment}
            errors={state.fields}
            onChange={(payments) => {
              queueOwnerPath("policies.payment");
              setPolicies((prev) => ({ ...prev, payments }));
            }}
          />
        ) : null}
        {vertical === "home_services" ? (
          <div id="bookings" className="scroll-mt-24">
            <SettingsGroup title="Bookings">
              <SettingsRow
                label="Book a time slot directly"
                control="switch"
                hint="Off: callers ask for a time and you confirm it. On: your Business Assistant books the time."
              >
                <ToolSwitch
                  checked={readBookingMode(policies) === "confirmed_slot"}
                  label="Book a time slot directly"
                  onChange={(next) => {
                    queueOwnerPath("policies.booking_mode");
                    setPolicies((prev) => ({ ...prev, ...bookingModePatch(next ? "confirmed_slot" : "request") }));
                  }}
                />
              </SettingsRow>
            </SettingsGroup>
          </div>
        ) : (
          <div id="holds" className="scroll-mt-24">
            <SettingsGroup title="Holds">
              <SettingsRow label="Hold items for customers" control="switch" hint="Your Business Assistant can hold a holdable item and alerts you each time.">
                <ToolSwitch
                  checked={readHoldRules(policies.holds).allowed === "yes"}
                  label="Hold items for customers"
                  onChange={(next) => {
                    const prevRules = readHoldRules(policies.holds);
                    queueOwnerPath("policies.holds.allowed");
                    queueOwnerPath("policies.holds");
                    setPolicies((prev) => ({
                      ...prev,
                      holds: holdRulesValue({
                        allowed: next ? "yes" : "no",
                        max_hours: prevRules.max_hours ?? 24,
                        deposit_required: prevRules.deposit_required || "no",
                      }),
                    }));
                  }}
                />
              </SettingsRow>
              {readHoldRules(policies.holds).allowed === "yes" ? (
                <>
                  <SettingsStack label="Longest hold">
                    <SettingsSegmented
                      label="Longest hold"
                      value={String(readHoldRules(policies.holds).max_hours ?? 24)}
                      options={HOLD_HOURS_OPTIONS.map((h) => ({ id: String(h), label: h < 24 ? `${h} hours` : h === 24 ? "1 day" : `${h / 24} days` }))}
                      onChange={(id) => {
                        queueOwnerPath("policies.holds");
                        setPolicies((prev) => ({
                          ...prev,
                          holds: holdRulesValue({ ...readHoldRules(prev.holds), max_hours: Number(id) }),
                        }));
                      }}
                    />
                  </SettingsStack>
                  <SettingsRow label="Deposit needed" control="switch">
                    <ToolSwitch
                      checked={readHoldRules(policies.holds).deposit_required === "yes"}
                      label="Deposit needed"
                      onChange={(next) => {
                        queueOwnerPath("policies.holds");
                        setPolicies((prev) => ({
                          ...prev,
                          holds: holdRulesValue({ ...readHoldRules(prev.holds), deposit_required: next ? "yes" : "no" }),
                        }));
                      }}
                    />
                  </SettingsRow>
                </>
              ) : null}
              {policies.deposit ? (
                <SettingsStack label="Hold note" htmlFor="policy-deposit">
                  <PolicyTextarea
                    id="policy-deposit"
                    value={policies.deposit}
                    onChange={(value) => {
                      if (value !== policies.deposit) queueOwnerPath("policies.deposit");
                      setPolicies((prev) => ({
                        ...prev,
                        deposit: value,
                        provenance: { ...prev.provenance, deposit: { source: "owner", confirmed: true } },
                      }));
                    }}
                    placeholder="Hold until 6pm with a name"
                  />
                </SettingsStack>
              ) : null}
            </SettingsGroup>
          </div>
        )}

        <PolicyRulesEditor
          rules={policies.rules ?? {}}
          legacy={{ returns: policies.returns, delivery: policies.delivery, cancellation: policies.cancellation, warranty: policies.warranty }}
          vertical={vertical}
          errors={state.fields}
          onChange={(rules) => {
            for (const key of ["returns", "delivery", "cancellation", "warranty"]) queueOwnerPath(`policies.${key}`);
            setPolicies((prev) => ({ ...prev, rules }));
          }}
        />

        <SettingsGroup title="Anything else">
          <SettingsStack label="Other rules callers should know" htmlFor="policy-other">
            <PolicyTextarea
              id="policy-other"
              value={policies.other}
              onChange={(value) => {
                if (value !== policies.other) queueOwnerPath("policies.other");
                setPolicies((prev) => ({
                  ...prev,
                  other: value,
                  provenance: { ...prev.provenance, other: { source: "owner", confirmed: true } },
                }));
              }}
              placeholder={POLICY_FIELDS.find((f) => f.id === "other")?.placeholder ?? ""}
            />
          </SettingsStack>
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
          {voiceOptions.length > 0 ? (
            <SettingsSelect
              id="soniox_voice_id"
              label="Voice"
              value={sonioxVoiceId}
              onChange={setSonioxVoiceId}
              options={voiceOptions.map((voice) => ({
                id: voice.id,
                label: displaySonioxVoiceLabel("", voice.id, voiceOptions),
              }))}
            />
          ) : (
            <p className="px-4 py-3 text-body text-ink-2">No voices loaded.</p>
          )}
          <SettingsRow label="Voice label" htmlFor="soniox_voice_label">
            <input
              id="soniox_voice_label"
              type="text"
              maxLength={40}
              value={sonioxVoiceLabel}
              onChange={(e) => setSonioxVoiceLabel(e.target.value)}
              placeholder="Shop voice"
              className={settingsValueFieldClass}
            />
          </SettingsRow>
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2">
            <p className="text-body text-ink-2">
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
            <p className="px-4 py-2 text-meta text-warn" role="alert" data-testid="voice-sample-empty">
              {voiceSampleError}
            </p>
          ) : null}
          <div className="space-y-1.5 px-4 py-3">
            <p className="text-body font-medium text-ink">On a call</p>
            <SettingsSegmented
              label="On a call"
              value={afterHoursMode}
              options={AFTER_HOURS_OPTIONS.map((opt) => ({
                id: opt.id,
                label: opt.label,
              }))}
              onChange={setAfterHoursMode}
            />
          </div>
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
        {membersSlot}
        {/* Live connect only appears once the runtime supports it. Today Scalers is callbacks only. */}
        {liveTransferExecutor ? (
          <>
            <div id="handoff" className="scroll-mt-24">
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
            </div>
            <p className="px-1 text-meta text-ink-2">
              {liveConnectBlurb(liveDest?.name)}
            </p>
          </>
        ) : null}

        <AlertContactsList
          team={team}
          flags={TEAM_NOTIFY_FLAGS}
          note={TEAM_NOTIFY_CHANNEL_NOTE}
          addLabel="Add person"
          onChange={updateTeam}
          canRemove={(m) => !isOwnerTeamRow(m.phone, tenant.whatsapp_notification_number)}
          onAdd={() => setTeam((prev) => [...prev, emptyMember()])}
          onRemove={(index) => {
            const member = team[index];
            if (!member) return;
            requestRemove(
              member,
              `Remove ${member.name.trim() || "this person"}?`,
              "They leave the team when you save.",
              () => setTeam((prev) => (prev.length <= 1 ? [emptyMember()] : prev.filter((_, i) => i !== index)))
            );
          }}
        />
      </section>

      <section
        id="golden-faqs"
        className={panel === "faqs" ? "space-y-3" : "hidden"}
      >
        <div className="flex flex-wrap items-end justify-between gap-2 px-1">
          <p className={settingsBlockTitleClass} aria-live="polite">
            FAQs
            <span className="ml-2 font-medium normal-case tracking-normal text-ink-2">
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
        <>
        <ol className="space-y-3" aria-label="FAQs" data-faq-list="">
          {visibleFaqs.map((faq, localIndex) => {
            const index = safeFaqPage * FAQ_PAGE_SIZE + localIndex;
            const dup = faqDupIndexes.has(index);
            return (
            <li key={`faq-${index}`}>
              <FieldCard
                data-faq-card=""
                title={`FAQ ${index + 1}`}
                action={
                  <button
                    type="button"
                    onClick={() =>
                      requestRemove(
                        faq,
                        "Remove this FAQ?",
                        "It leaves the list when you save.",
                        () => setFaqs((prev) => prev.filter((_, i) => i !== index))
                      )
                    }
                    className={settingsTrashButtonClass}
                    aria-label={`Remove FAQ ${index + 1}`}
                  >
                    <TrashIcon className="h-5 w-5" />
                  </button>
                }
              >
                <TextField
                  id={`faq-q-${index}`}
                  label={<>Question<span className="sr-only"> {index + 1}</span></>}
                  value={faq.question}
                  maxLength={FAQ_QUESTION_MAX}
                  placeholder="Do you deliver on Sundays?"
                  onChange={(e) => updateFaq(index, "question", e.target.value)}
                  error={dup ? "Same as another FAQ. Keep one clear wording." : null}
                />
                <TextAreaField
                  id={`faq-a-${index}`}
                  label={<>Answer<span className="sr-only"> to FAQ {index + 1}</span></>}
                  value={faq.answer}
                  maxLength={FAQ_ANSWER_MAX}
                  rows={3}
                  hint="Write it the way you would say it on the phone."
                  onChange={(e) => updateFaq(index, "answer", e.target.value)}
                />
              </FieldCard>
            </li>
            );
          })}
        </ol>
        {faqs.length > FAQ_PAGE_SIZE ? (
        <Pagination
          page={safeFaqPage + 1}
          pageSize={FAQ_PAGE_SIZE}
          total={faqs.length}
          noun="FAQ"
          onPage={(next) => setFaqPage(next - 1)}
          className="rounded-2xl border border-hairline bg-surface px-3 py-3"
        />
        ) : null}
        </>
        ) : null}
      </section>
      </div>

        </div>
      </div>
      <ConfirmSheet
        open={removeAsk != null}
        title={removeView?.title || "Remove?"}
        confirmLabel="Remove"
        danger
        onClose={() => setRemoveAsk(null)}
        onConfirm={() => {
          const run = removeView?.run;
          setRemoveAsk(null);
          run?.();
        }}
      >
        {removeView?.body}
      </ConfirmSheet>
    </form>
  );
}

export const TenantForm = withRoleGate("settings.edit", TenantFormInner);
