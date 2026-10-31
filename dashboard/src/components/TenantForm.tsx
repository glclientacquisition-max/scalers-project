"use client";

import { AlertContactsList } from "@/components/AlertContactsList";

import { useCan, withRoleGate } from "@/components/DeskRole";
import { AutoGrowTextarea, CharCount as KitCharCount } from "@/components/ui/TextField";
import { POLICY_TEXT_MAX } from "@/lib/lengthLimits";
import { normalizeContactPhone } from "@/lib/teamValidation";
import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ChevronRightIcon } from "@heroicons/react/20/solid";
import { Sheet } from "@/components/ui/Sheet";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { businessSettingsHref } from "@/lib/businessSettingsNav";
import type { FaqEntry, TeamDirectoryEntry, TenantRow } from "@/lib/supabase";
import {
  canonicalizeAgentTone,
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
import { CatalogPriceEditor } from "@/components/settings/catalog/CatalogPriceEditor";
import {
  transitionCatalogPriceKind,
  type CatalogPriceDraft,
} from "@/lib/catalogPriceEditorState";
import {
  applyCatalogPriceFields,
  catalogPriceInputsFromRow,
  type PriceKind,
} from "@/lib/catalogPricingMode";
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
  mergeProductCatalog,
  productImportWarnings,
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
  normalizeSocialHandles,
  type SocialHandles,
} from "@/lib/socialHandles";
import { catalogPriceFieldKey } from "@/lib/catalogValidation";
import {
  saveAndCompileSettings,
  type SettingsCompileState,
} from "@/app/(desk)/settings/actions";
import {
  FAQ_ANSWER_MAX,
  FAQ_MAX,
  FAQ_QUESTION_MAX,
  clampFaq,
} from "@/lib/faqs";
import { SERVICES_PASTE_POOLS, placeholderPool } from "@/lib/deskPlaceholders";
import { useMountedPoolPick } from "@/lib/useMountedPoolPick";
import {
  parseVertical,
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
  seedStarterPolicies,
  type StarterPolicyKey,
  readBookingMode,
  readHoldRules,
  POLICY_FIELDS,
  type BusinessPolicies,
} from "@/lib/businessPolicies";
import { PlacesEditor } from "@/components/structured/PlacesEditor";
import { defaultNoPremises } from "@/lib/serviceAreas";
import { SegmentedControl } from "@/components/ui/Segmented";
import { stableRowId } from "@/lib/factHash";
import { catalogBaseline, isUnpricedRow } from "@/lib/catalogPricing";
import { DeskSelect } from "@/components/ui/DeskSelect";
import { PaymentsEditor } from "@/components/structured/PaymentsEditor";
import { PolicyRulesEditor } from "@/components/structured/PolicyRulesEditor";
import dynamic from "next/dynamic";
// Pronunciation is one panel of many; load it only when that panel renders.
const PronunciationCoach = dynamic(() => import("@/components/PronunciationCoach").then((m) => m.PronunciationCoach));
import { ConfirmSheet } from "@/components/ui/ConfirmSheet";
import { Button } from "@/components/ui/Button";
import { Empty } from "@/components/ui/Empty";
import { notify } from "@/components/ui/DeskNotice";
import { useFormDraft, useFormSave } from "@/components/useFormSave";
import { carrySavedRow, isSavedRow, markSavedRow } from "@/lib/savedRow";
import { Pagination } from "@/components/ui/Pagination";
import {
  ExpandTextarea,
  SettingsGroup,
  SettingsPageHeader,
  SettingsRow,
  SettingsSegmented,
  SettingsStack,
  ToolSwitch,
  TrashIcon,
  settingsBlockTitleClass,
  settingsConsoleClass,
  settingsFormBodyClass,
  settingsDenseFieldClass,
  settingsGhostButtonClass,
  settingsPanelClass,
  settingsTableFieldClass,
  settingsTrashButtonClass,
} from "@/components/settingsUi";
import { TENANT_SETTINGS_FORM_ID } from "@/components/TenantSettingsSaveButton";
import { useDirty } from "@/lib/settingsDirty";
import { panelPostsField } from "@/lib/settingsFormFields";
import { SettingsActionBar } from "@/components/settings/SettingsActionBar";
import { UnknownAnswerField } from "@/components/UnknownAnswerField";
import {
  UNKNOWN_ANSWER_DEFAULT_EN,
  ownerUnknownAnswer,
  parseUnknownAnswerSpoken,
  unknownAnswerBoxText,
} from "@/lib/unknownAnswerSpoken";
import type { PronunciationReviewCandidate } from "@/lib/pronunciationGeminiScan";
import {
  lexiconWordsToRemove,
  parseTtsLexicon,
  lexiconForStorage,
  type TtsLexiconEntry,
} from "@/lib/pronunciationLexicon";
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

const tableFieldClass = settingsTableFieldClass;
const denseFieldClass = settingsDenseFieldClass;
/** Phone service rows: labels stay visible (no placeholder-only fields at 360/390). */
const serviceMobileLabelClass = "mb-1 block text-meta text-ink-2";

function catalogPriceError(
  fields: SettingsCompileState["fields"],
  name: string
): string | null {
  const key = name.trim().toLowerCase();
  if (!key || !fields) return null;
  return fields[catalogPriceFieldKey(name)] ?? null;
}

type CatalogPriceDraftMap = Record<string, CatalogPriceDraft>;

function servicePriceDraftKey(row: ServiceItem, index: number): string {
  return stableRowId(row) || `service:${index}`;
}

function productPriceDraftKey(row: ProductItem, index: number): string {
  const sku = row.sku.trim();
  return stableRowId(row) || (sku ? `product:${sku}` : `product:${index}`);
}

function getServicePriceFields(
  row: ServiceItem,
  index: number,
  drafts: CatalogPriceDraftMap
): CatalogPriceDraft {
  const key = servicePriceDraftKey(row, index);
  return drafts[key] ?? catalogPriceInputsFromRow(row);
}

function getProductPriceFields(
  row: ProductItem,
  index: number,
  drafts: CatalogPriceDraftMap
): CatalogPriceDraft {
  const key = productPriceDraftKey(row, index);
  return drafts[key] ?? catalogPriceInputsFromRow(row);
}

function applyDraftToCatalogRow<T extends ServiceItem | ProductItem>(
  row: T,
  draft: CatalogPriceDraft,
  textKey: "price_range" | "price"
): T {
  return applyCatalogPriceFields(row, draft.kind, draft.minInput, draft.maxInput, textKey);
}

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
  seatNoteSlot = null,
  structuredSlot = null,
  onSaveActivity,
  pronunciationReview = [],
  pronunciationQueueFailed = false,
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
  /** Team: one note when every seat is taken. */
  seatNoteSlot?: ReactNode;
  /** Typed-data groups (payments, price checks, category) rendered by the server page per panel. */
  structuredSlot?: Partial<Record<"identity" | "catalog", ReactNode>> | null;
  /** Shared save pattern: a save started or landed (BusinessSettingsShell keeps the mount). */
  onSaveActivity?: () => void;
  /** Server-loaded pronunciation review. Empty when this panel is not open. */
  pronunciationReview?: PronunciationReviewCandidate[];
  /** The review read failed. Stored words still render. */
  pronunciationQueueFailed?: boolean;
}) {
  // View-only members still open place details; PlacesEditor shows them read-only.
  const canEditSettings = useCan("settings.edit");
  const voiceOptions =
    curatedVoices && curatedVoices.length
      ? curatedVoices
      : listCuratedSonioxVoicesSync();
  const [businessName] = useState(tenant.business_name || "");
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
  const [servicePriceDrafts, setServicePriceDrafts] = useState<CatalogPriceDraftMap>({});
  const [productPriceDrafts, setProductPriceDrafts] = useState<CatalogPriceDraftMap>({});
  const [socialHandles] = useState<SocialHandles>(() => {
    const next = normalizeSocialHandles(tenant.social_handles);
    return { channels: next.channels.map((row) => markSavedRow(row)) };
  });
  const [bulkServicesText, setBulkServicesText] = useState("");
  const [bulkServicesError, setBulkServicesError] = useState<string | null>(null);
  const [bulkServicesNote, setBulkServicesNote] = useState<string | null>(null);
  const [servicesImportOpen, setServicesImportOpen] = useState(false);
  const [productsImportOpen, setProductsImportOpen] = useState(false);
  const [bulkProductsText, setBulkProductsText] = useState("");
  const [bulkProductsUpdate, setBulkProductsUpdate] = useState(false);
  const [bulkProductsError, setBulkProductsError] = useState<string | null>(null);
  const [servicePage, setServicePage] = useState(0);
  const [productPage, setProductPage] = useState(0);
  const [unpricedOnly, setUnpricedOnly] = useState(false);
  useEffect(() => {
    // Read after mount so server and first client render agree.
    if (new URLSearchParams(window.location.search).get("filter") === "unpriced") setUnpricedOnly(true);
  }, []);
  const [faqQuery, setFaqQuery] = useState("");
  const [faqEditor, setFaqEditor] = useState<number | "new" | null>(null);
  const [faqDraft, setFaqDraft] = useState({ question: "", answer: "" });
  const [faqRemove, setFaqRemove] = useState<number | null>(null);
  const [unknownText, setUnknownText] = useState(() => unknownAnswerBoxText(tenant.unknown_answer_fallback));
  const unknownLine = ownerUnknownAnswer(unknownText);
  const [storedSpoken] = useState(() => {
    const pair = parseUnknownAnswerSpoken(tenant.unknown_answer_spoken);
    return pair && pair.source === ownerUnknownAnswer(tenant.unknown_answer_fallback) ? pair : null;
  });
  const [spokenEn, setSpokenEn] = useState(storedSpoken?.en ?? "");
  const [spokenSw, setSpokenSw] = useState(storedSpoken?.sw ?? "");
  const [spokenSource, setSpokenSource] = useState(storedSpoken?.source ?? "");
  const [spokenTouched, setSpokenTouched] = useState(false);
  const [agentName] = useState(tenant.agent_name || "");
  const [spokenName] = useState(tenant.spoken_name || "");
  const [greetingInvite] = useState(tenant.greeting_invite || "");
  const [tone] = useState<OnboardingTone | "">(initialTone(tenant));
  const [daySheet, setDaySheet] = useState<DayKey | null>(null);
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
  const [vertical] = useState<BusinessVertical>(() =>
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
  const [policies, setPolicies] = useState<BusinessPolicies>(() =>
    normalizeBusinessPolicies(tenant.business_policies)
  );
  const [starterClear, setStarterClear] = useState<StarterPolicyKey | null>(null);
  const starterPolicies = seedStarterPolicies(policies);
  // Starter text shows once, in the Starter text group; not again as an old rule line,
  // a payment quote, or the Hold note.
  const starterKeys = new Set<string>(starterPolicies.map((row) => row.key));
  const ownerLegacy = (key: StarterPolicyKey) => (starterKeys.has(key) ? undefined : policies[key]);
  const markPolicyOwner = (key: StarterPolicyKey, clear: boolean) => {
    queueOwnerPath(`policies.${key}`);
    setPolicies((prev) => {
      const next: BusinessPolicies = {
        ...prev,
        provenance: { ...prev.provenance, [key]: { source: "owner", confirmed: true } },
      };
      if (clear) {
        next[key] = "";
        if (prev.rules && key in prev.rules) {
          const rules = { ...prev.rules };
          delete (rules as Record<string, unknown>)[key];
          next.rules = rules;
        }
      }
      return next;
    });
  };
  const [agentTools, setAgentTools] = useState<AgentTools>(() =>
    parseAgentTools(tenant.agent_tools)
  );
  const [sonioxVoiceId] = useState(() =>
    initialSonioxVoiceId(tenant, voiceOptions)
  );
  const [sonioxVoiceLabel] = useState(
    () => String(tenant.soniox_voice_label || "").trim()
  );
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
  // Shared save pattern (useFormSave): toast, inline Saved, errors with retry,
  // dropped connections. The draft side (dirty, guard) is useFormDraft below.
  const save = useFormSave<SettingsCompileState>({
    action: saveAndCompileSettings,
    initialState: initial,
    successMessage: "Saved · training line",
    formId: TENANT_SETTINGS_FORM_ID,
    onSaveStart: onSaveActivity,
    onLanded: onSaveActivity,
  });
  const { state, pending } = save;
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
  // Locations › Your premises. Stored as tenants.service_areas.no_premises (same key as before #964).
  const [noPremises, setNoPremises] = useState(() => {
    const policies = tenant.business_policies;
    const coverage = policies && typeof policies === "object" && Array.isArray((policies as { coverage_areas?: unknown }).coverage_areas)
      ? (policies as { coverage_areas: unknown[] }).coverage_areas.length
      : 0;
    return defaultNoPremises(tenant.service_areas, tenant.vertical, coverage);
  });
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
  const servicesJson = useMemo(
    () =>
      JSON.stringify(
        services
          .map((row, index) => {
            const draft = getServicePriceFields(row, index, servicePriceDrafts);
            return applyDraftToCatalogRow(row, draft, "price_range");
          })
          .filter((s) => s.name.trim())
      ),
    [services, servicePriceDrafts]
  );
  const productsJson = useMemo(
    () =>
      JSON.stringify(
        products
          .map((row, index) => {
            const draft = getProductPriceFields(row, index, productPriceDrafts);
            return applyDraftToCatalogRow(row, draft, "price");
          })
          .filter((p) => p.name.trim())
      ),
    [products, productPriceDrafts]
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
  const safeServicePage = Math.min(servicePage, servicePageCount - 1);
  const safeProductPage = Math.min(productPage, productPageCount - 1);
  const visibleServices = serviceIdx
    .slice(safeServicePage * SERVICE_PAGE_SIZE, safeServicePage * SERVICE_PAGE_SIZE + SERVICE_PAGE_SIZE)
    .map((i) => services[i]);
  const visibleProducts = productIdx
    .slice(safeProductPage * PRODUCT_PAGE_SIZE, safeProductPage * PRODUCT_PAGE_SIZE + PRODUCT_PAGE_SIZE)
    .map((i) => products[i]);
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

  // Synced during render, not in an effect, so the saved baseline below already holds the new pair.
  const [spokenSyncedState, setSpokenSyncedState] = useState(state);
  if (spokenSyncedState !== state) {
    setSpokenSyncedState(state);
    if (state.ok && Object.prototype.hasOwnProperty.call(state, "unknownAnswerSpoken")) {
      const next = state.unknownAnswerSpoken;
      setSpokenEn(next?.en ?? "");
      setSpokenSw(next?.sw ?? "");
      setSpokenSource(next?.source ?? "");
      setSpokenTouched(false);
    }
  }

  useEffect(() => {
    // Compile finished before ok - owners should hear the line was trained, not only "Saved".
    // The write has usually landed: refetch so the page shows what is stored.
    if (state.networkError) router.refresh();
  }, [state, router]);

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

  function storedFaqs(rows: FaqEntry[]) {
    return JSON.stringify(rows.filter((f) => f.question.trim() && f.answer.trim()).map((f) => clampFaq(f)));
  }

  function commitFaqs(next: FaqEntry[]) {
    setFaqs(next);
    const form = document.getElementById(TENANT_SETTINGS_FORM_ID) as HTMLFormElement | null;
    const input = form?.querySelector<HTMLInputElement>('input[name="faqs"]');
    if (input) input.value = storedFaqs(next);
    if (panel === "faqs") form?.requestSubmit();
  }

  function openFaqEditor(index: number | "new") {
    if (index === "new") {
      setFaqDraft({ question: "", answer: "" });
    } else {
      const row = faqs[index];
      setFaqDraft({ question: row?.question || "", answer: row?.answer || "" });
    }
    setFaqEditor(index);
  }

  function saveFaqEditor() {
    const question = faqDraft.question.trim();
    const answer = faqDraft.answer.trim();
    if (!question || !answer || faqEditor == null) return;
    if (faqEditor === "new") {
      commitFaqs([...faqs, { question, answer, source: "owner", status: "confirmed", confirmed: true }]);
    } else {
      commitFaqs(faqs.map((row, i) => (i === faqEditor ? { ...row, question, answer, source: "owner", status: row.status === "golden" ? "golden" : "confirmed", confirmed: true } : row)));
    }
    setFaqEditor(null);
  }

  function confirmRemoveFaq(index: number) {
    const removed = faqs[index];
    if (!removed) return;
    const next = faqs.filter((_, i) => i !== index);
    commitFaqs(next);
    setFaqRemove(null);
    setFaqEditor(null);
    notify("FAQ removed", {
      action: {
        label: "Undo",
        run: () => {
          const restored = [...next];
          restored.splice(index, 0, removed);
          commitFaqs(restored);
        },
      },
    });
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

  function updateServicePrice(index: number, kind: PriceKind, minInput: string, maxInput: string) {
    const current = services[index];
    if (!current) return;
    if (current.name.trim()) {
      queueOwnerPath(`catalog.service.${stableRowId(current) || String(index + 1)}.name`);
    }
    const key = servicePriceDraftKey(current, index);
    const prevDraft = getServicePriceFields(current, index, servicePriceDrafts);
    const nextDraft =
      kind !== prevDraft.kind
        ? transitionCatalogPriceKind(prevDraft, kind)
        : { kind, minInput, maxInput };
    setServicePriceDrafts((prev) => ({ ...prev, [key]: nextDraft }));
    setServices((prev) =>
      prev.map((row, i) => {
        if (i !== index) return row;
        const next =
          nextDraft.kind === "quote"
            ? applyCatalogPriceFields(row, "quote", "", "", "price_range")
            : applyCatalogPriceFields(
                row,
                nextDraft.kind,
                nextDraft.minInput,
                nextDraft.maxInput,
                "price_range"
              );
        return carrySavedRow({ ...next, source: "owner" }, row);
      })
    );
  }

  function updateProductPrice(index: number, kind: PriceKind, minInput: string, maxInput: string) {
    const current = products[index];
    if (!current) return;
    if (current.name.trim()) {
      const sku = current.sku.trim() || String(index + 1);
      queueOwnerPath(`catalog.product.${sku}.name`);
    }
    const key = productPriceDraftKey(current, index);
    const prevDraft = getProductPriceFields(current, index, productPriceDrafts);
    const nextDraft =
      kind !== prevDraft.kind
        ? transitionCatalogPriceKind(prevDraft, kind)
        : { kind, minInput, maxInput };
    setProductPriceDrafts((prev) => ({ ...prev, [key]: nextDraft }));
    setProducts((prev) =>
      prev.map((row, i) => {
        if (i !== index) return row;
        const next =
          nextDraft.kind === "quote"
            ? applyCatalogPriceFields(row, "quote", "", "", "price")
            : applyCatalogPriceFields(
                row,
                nextDraft.kind,
                nextDraft.minInput,
                nextDraft.maxInput,
                "price"
              );
        return carrySavedRow({ ...next, source: "owner" }, row);
      })
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

  const bulkPreview = useMemo(
    () => previewSuggestedServices(parseBulkServices(bulkServicesText), vertical),
    [bulkServicesText, vertical]
  );
  const bulkProductPreview = useMemo(
    () => previewSuggestedProducts(parseBulkProducts(bulkProductsText)),
    [bulkProductsText]
  );

  // Locations drawers ("Save 3 areas", "Done") save the page straight away.
  const saveAfterLocationsRef = useRef(false);
  useEffect(() => {
    if (!saveAfterLocationsRef.current) return;
    saveAfterLocationsRef.current = false;
    const form = document.getElementById(TENANT_SETTINGS_FORM_ID);
    if (form instanceof HTMLFormElement) form.requestSubmit();
  }, [locations]);

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
    const existing = services.filter((s) => s.name.trim());
    const combined = [...existing, ...parsed];
    const dropped = Math.max(0, combined.length - 40);
    setServices(combined.slice(0, 40));
    setBulkServicesNote(
      dropped > 0
        ? `Services stay at 40. ${dropped} more ${dropped === 1 ? "was" : "were"} left out.`
        : null,
    );
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
    setProducts((prev) =>
      mergeProductCatalog(
        prev.filter((p) => p.name.trim()),
        parsed,
        bulkProductsUpdate ? "update" : "merge"
      )
    );
    saveAfterPasteRef.current = true;
    setBulkProductsText("");
    setBulkProductsError(null);
  }

  function copyDayToWeekdays(day: DayKey) {
    setHoursSchedule((prev) => {
      const slot = prev.days[day];
      return {
        ...prev,
        days: { ...prev.days, mon: slot, tue: slot, wed: slot, thu: slot, fri: slot },
      };
    });
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
  // Everything the Save button posts. Compared normalised (useFormDraft).
  const draftValues = [
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
    unknownLine,
    spokenTouched ? `${spokenEn}\u0002${spokenSw}` : "",
    teamJson,
    faqsJson,
    agentTools.escalate ? "1" : "0",
    agentTools.end_call ? "1" : "0",
    sonioxVoiceId,
    sonioxVoiceLabel,
    ttsLexiconJson,
    noPremises ? "1" : "0",
  ];
  // adoptsResult: a save hands back the spoken When unsure pair, synced above in render.
  const { dirty, justSaved } = useFormDraft(save, { id: "form", values: draftValues, adoptsResult: true });
  const [draftSnapshot] = useState(() => draftValues);
  const counted = useDirty(draftSnapshot, draftValues);
  const [wordsToRemove] = useState(() => lexiconWordsToRemove(tenant.tts_lexicon));
  const pendingRemovals = justSaved ? 0 : wordsToRemove;
  const removalOnly = panel === "pronunciation" && pendingRemovals > 0 && !dirty;
  const changes = dirty ? counted : removalOnly ? 1 : 0;
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
      onSubmit={(event) => {
        // Pronunciation saves live via its own actions. Enter inside the coach
        // must not post this form (feels like a full Settings reload).
        const submitter = (event.nativeEvent as SubmitEvent).submitter;
        if (panel === "pronunciation" && !submitter?.hasAttribute("data-settings-save")) {
          event.preventDefault();
          return;
        }
        // Shared save pattern: posts without React's form reset, which would put
        // the Voice tool switches back to their first-render state.
        save.onSubmit(event);
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
            alert={save.error}
            onRetry={save.retry}
          />

      <div className={`${settingsFormBodyClass} space-y-4`}>
      <input type="hidden" name="id" value={tenant.id} />
      <input type="hidden" name="settings_scope" value={panel} />
      {panelPostsField(panel, "business_name") ? <input type="hidden" name="business_name" value={businessName} /> : null}
      {panelPostsField(panel, "services_offered") ? <input type="hidden" name="services_offered" value={servicesOfferedSummary} /> : null}
      {panelPostsField(panel, "services_catalog") ? <input type="hidden" name="services_catalog" value={servicesJson} /> : null}
      {panelPostsField(panel, "product_catalog") ? <input type="hidden" name="product_catalog" value={productsJson} /> : null}
      {panelPostsField(panel, "catalog_baseline") ? <input type="hidden" name="catalog_baseline" value={catalogBaseJson} /> : null}
      {panelPostsField(panel, "social_handles") ? <input type="hidden" name="social_handles" value={socialJson} /> : null}
      {panelPostsField(panel, "services_notes") ? <input type="hidden" name="services_notes" value={servicesNotes} /> : null}
      {panelPostsField(panel, "business_hours") ? <input type="hidden" name="business_hours" value={businessHoursSummary} /> : null}
      {panelPostsField(panel, "hours_schedule") ? <input type="hidden" name="hours_schedule" value={hoursScheduleJson} /> : null}
      {panelPostsField(panel, "location_notes") ? <input type="hidden" name="location_notes" value={locationNotesField} /> : null}
      {panelPostsField(panel, "after_hours_mode") ? <input type="hidden" name="after_hours_mode" value={afterHoursMode} /> : null}
      {panelPostsField(panel, "vertical") ? <input type="hidden" name="vertical" value={vertical} /> : null}
      {panelPostsField(panel, "handoff_mode") ? <input type="hidden" name="handoff_mode" value={handoffMode} /> : null}
      {panelPostsField(panel, "business_locations") ? <input type="hidden" name="business_locations" value={locationsJson} /> : null}
      {panelPostsField(panel, "no_premises") ? <input type="hidden" name="no_premises" value={noPremises ? "1" : "0"} /> : null}
      {panelPostsField(panel, "business_policies") ? <input type="hidden" name="business_policies" value={policiesJson} /> : null}
      {panelPostsField(panel, "agent_name") ? <input type="hidden" name="agent_name" value={agentName} /> : null}
      {panelPostsField(panel, "spoken_name") ? <input type="hidden" name="spoken_name" value={spokenName} /> : null}
      {panelPostsField(panel, "greeting_invite") ? <input type="hidden" name="greeting_invite" value={greetingInvite} /> : null}
      {panelPostsField(panel, "agent_tone") ? <input type="hidden" name="agent_tone" value={tone} /> : null}
      {panelPostsField(panel, "unknown_answer_fallback") ? <input type="hidden" name="unknown_answer_fallback" value={unknownLine} /> : null}
      {panelPostsField(panel, "unknown_answer_spoken_en") ? <input type="hidden" name="unknown_answer_spoken_en" value={spokenEn} /> : null}
      {panelPostsField(panel, "unknown_answer_spoken_sw") ? <input type="hidden" name="unknown_answer_spoken_sw" value={spokenSw} /> : null}
      {panelPostsField(panel, "unknown_answer_spoken_touched") ? <input type="hidden" name="unknown_answer_spoken_touched" value={spokenTouched ? "1" : "0"} /> : null}
      {panelPostsField(panel, "team_directory") ? <input type="hidden" name="team_directory" value={teamJson} /> : null}
      {panelPostsField(panel, "faqs") ? <input type="hidden" name="faqs" value={faqsJson} /> : null}
      {panelPostsField(panel, "owner_field_paths") ? <input type="hidden" name="owner_field_paths" value={JSON.stringify(ownerPaths)} /> : null}
      {panelPostsField(panel, "tool_escalate") ? <input type="hidden" name="tool_escalate" value={agentTools.escalate ? "1" : "0"} /> : null}
      {panelPostsField(panel, "tool_end_call") ? <input type="hidden" name="tool_end_call" value={agentTools.end_call ? "1" : "0"} /> : null}
      {panelPostsField(panel, "soniox_voice_id") ? <input type="hidden" name="soniox_voice_id" value={sonioxVoiceId} /> : null}
      {panelPostsField(panel, "soniox_voice_label") ? <input type="hidden" name="soniox_voice_label" value={sonioxVoiceLabel} /> : null}
      {panelPostsField(panel, "tts_lexicon") ? <input type="hidden" name="tts_lexicon" value={ttsLexiconJson} /> : null}

      <section className={panel === "catalog" ? "space-y-4" : "hidden"}>
        {panel === "catalog" ? structuredSlot?.catalog : null}
        <CatalogSectionShell
          vertical={vertical}
          title="Catalogue"
          emptyTitle="No services yet"
          isEmpty={false}
        >
        <div className="space-y-3">
          {state.error ? (
            <p className="text-body text-warn" role="alert">
              {state.error}
            </p>
          ) : null}
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
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
          {bulkServicesNote ? (
            <p className="text-body text-ink-2" role="status">
              {bulkServicesNote}
            </p>
          ) : null}

          <div className="divide-y divide-hairline overflow-hidden rounded-xl border border-hairline lg:hidden">
            {visibleServices.map((service, localIndex) => {
              const index = serviceIdx[safeServicePage * SERVICE_PAGE_SIZE + localIndex];
              const priceError = catalogPriceError(state.fields, service.name);
              const priceFields = getServicePriceFields(service, index, servicePriceDrafts);
              return (
                <div key={`service-m-${index}`} className="grid grid-cols-[minmax(0,1fr)_2.75rem] items-start gap-x-2 gap-y-2 px-3 py-2.5">
                  <div className="min-w-0">
                    <label className={serviceMobileLabelClass} htmlFor={`svc-name-m-${index}`}>Service</label>
                    <input id={`svc-name-m-${index}`} value={service.name} onChange={(e) => updateService(index, "name", e.target.value)} placeholder={vertical === "retail" ? "Book sourcing / special orders" : "Home cleaning"} className={denseFieldClass} />
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
                  <CatalogPriceEditor
                    idPrefix={`svc-price-m-${index}`}
                    kind={priceFields.kind}
                    minInput={priceFields.minInput}
                    maxInput={priceFields.maxInput}
                    fieldClass={denseFieldClass}
                    labelClass={serviceMobileLabelClass}
                    onKindChange={(kind) =>
                      updateServicePrice(index, kind, priceFields.minInput, priceFields.maxInput)
                    }
                    onMinChange={(value) =>
                      updateServicePrice(index, priceFields.kind, value, priceFields.maxInput)
                    }
                    onMaxChange={(value) =>
                      updateServicePrice(index, priceFields.kind, priceFields.minInput, value)
                    }
                    revealAllErrors={Boolean(priceError)}
                  />
                  {priceError ? (
                    <p id={`svc-price-m-${index}-error`} className="col-span-2 text-meta text-warn" role="alert">
                      {priceError}
                    </p>
                  ) : null}
                  <div className="col-span-3 min-w-0">
                    <label className={serviceMobileLabelClass} htmlFor={`svc-notes-m-${index}`}>Notes</label>
                    <input id={`svc-notes-m-${index}`} value={service.notes} onChange={(e) => updateService(index, "notes", e.target.value)} className={denseFieldClass} />
                  </div>
                  <div className="col-span-2 min-w-0">
                    <label className={serviceMobileLabelClass} htmlFor={`svc-oos-m-${index}`}>Not offered</label>
                    <input id={`svc-oos-m-${index}`} value={service.out_of_scope} onChange={(e) => updateService(index, "out_of_scope", e.target.value)} className={denseFieldClass} />
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
                    const priceError = catalogPriceError(state.fields, service.name);
                    const priceFields = getServicePriceFields(service, index, servicePriceDrafts);
                    return (
                      <Fragment key={`service-${index}`}>
                        <tr className="align-top">
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
                            <label className="sr-only" htmlFor={`svc-notes-${index}`}>
                              Notes
                            </label>
                            <input
                              id={`svc-notes-${index}`}
                              value={service.notes}
                              onChange={(e) => updateService(index, "notes", e.target.value)}
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
                        <tr className="border-b border-hairline">
                          <td colSpan={4} className="px-3 pb-3 pt-0">
                            <CatalogPriceEditor
                              idPrefix={`svc-price-${index}`}
                              kind={priceFields.kind}
                              minInput={priceFields.minInput}
                              maxInput={priceFields.maxInput}
                              fieldClass={tableFieldClass}
                              onKindChange={(kind) =>
                                updateServicePrice(index, kind, priceFields.minInput, priceFields.maxInput)
                              }
                              onMinChange={(value) =>
                                updateServicePrice(index, priceFields.kind, value, priceFields.maxInput)
                              }
                              onMaxChange={(value) =>
                                updateServicePrice(index, priceFields.kind, priceFields.minInput, value)
                              }
                              revealAllErrors={Boolean(priceError)}
                            />
                            {priceError ? (
                              <p id={`svc-price-${index}-error`} className="mt-1 text-meta text-warn" role="alert">
                                {priceError}
                              </p>
                            ) : null}
                          </td>
                        </tr>
                      </Fragment>
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
            warningsFor={(row) => productImportWarnings(row as ProductItem)}
            updateExisting={{ checked: bulkProductsUpdate, onChange: setBulkProductsUpdate }}
          />
          {bulkProductsError ? (
            <p className="text-body text-warn" role="alert">
              {bulkProductsError}
            </p>
          ) : null}

          {unpricedOnly ? (
            <div data-unpriced-filter="" className="flex min-h-11 items-center justify-between gap-3 rounded-xl bg-accent-tonal px-4 py-2">
              <p className="text-meta text-ink">
                Showing {productIdx.length + serviceIdx.length} without a price. Add one, or choose Quote on request for a callback.
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
                const priceError = catalogPriceError(state.fields, product.name);
                const priceFields = getProductPriceFields(product, index, productPriceDrafts);
                return (
                  <div key={`product-m-${index}`} className="grid grid-cols-[minmax(0,1fr)_2.75rem] items-start gap-2 px-3 py-2">
                    <div className="min-w-0">
                      <label className="sr-only" htmlFor={`prod-name-m-${index}`}>Name</label>
                      <input id={`prod-name-m-${index}`} value={product.name} onChange={(e) => updateProduct(index, "name", e.target.value)} placeholder="Atomic Habits" className={denseFieldClass} />
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
                    <CatalogPriceEditor
                      idPrefix={`prod-price-m-${index}`}
                      kind={priceFields.kind}
                      minInput={priceFields.minInput}
                      maxInput={priceFields.maxInput}
                      fieldClass={denseFieldClass}
                      onKindChange={(kind) =>
                        updateProductPrice(index, kind, priceFields.minInput, priceFields.maxInput)
                      }
                      onMinChange={(value) =>
                        updateProductPrice(index, priceFields.kind, value, priceFields.maxInput)
                      }
                      onMaxChange={(value) =>
                        updateProductPrice(index, priceFields.kind, priceFields.minInput, value)
                      }
                      revealAllErrors={Boolean(priceError)}
                    />
                    {priceError ? (
                      <p id={`prod-price-m-${index}-error`} className="col-span-2 text-meta text-warn" role="alert">
                        {priceError}
                      </p>
                    ) : null}
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
                      const priceError = catalogPriceError(state.fields, product.name);
                      const priceFields = getProductPriceFields(product, index, productPriceDrafts);
                      return (
                        <Fragment key={`product-${index}`}>
                          <tr className="align-top">
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
                          <tr className="border-b border-hairline">
                            <td colSpan={4} className="px-3 pb-3 pt-0">
                              <CatalogPriceEditor
                                idPrefix={`prod-price-${index}`}
                                kind={priceFields.kind}
                                minInput={priceFields.minInput}
                                maxInput={priceFields.maxInput}
                                fieldClass={tableFieldClass}
                                onKindChange={(kind) =>
                                  updateProductPrice(index, kind, priceFields.minInput, priceFields.maxInput)
                                }
                                onMinChange={(value) =>
                                  updateProductPrice(index, priceFields.kind, value, priceFields.maxInput)
                                }
                                onMaxChange={(value) =>
                                  updateProductPrice(index, priceFields.kind, priceFields.minInput, value)
                                }
                                revealAllErrors={Boolean(priceError)}
                              />
                              {priceError ? (
                                <p id={`prod-price-${index}-error`} className="mt-1 text-meta text-warn" role="alert">
                                  {priceError}
                                </p>
                              ) : null}
                            </td>
                          </tr>
                        </Fragment>
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
        <p className="px-1 text-body text-ink md:hidden" data-hours-summary="">
          {formatHoursForOwner(hoursSchedule) || "Set your open days"}
        </p>
        <ul className="overflow-hidden rounded-2xl border border-hairline bg-surface md:hidden">
          {DAY_ORDER.map((day) => {
            const slot = hoursSchedule.days[day];
            return (
              <li key={day} className="border-b border-hairline last:border-b-0">
                <button
                  type="button"
                  onClick={() => setDaySheet(day)}
                  className="flex min-h-11 w-full items-center gap-3 px-4 text-start hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand"
                >
                  <span className="min-w-0 flex-1 text-body font-medium text-ink">{DAY_LABELS[day]}</span>
                  <span className="shrink-0 text-meta tabular-nums text-ink-2">{slot ? `${slot.open}-${slot.close}` : "Closed"}</span>
                  <ChevronRightIcon className="size-5 shrink-0 text-ink-3" aria-hidden />
                </button>
              </li>
            );
          })}
        </ul>
        <div className="hidden md:block">
        <SettingsGroup title="Hours">
          <div className="hidden bg-surface-canvas px-3 py-2 text-meta font-medium text-ink-2 md:grid md:grid-cols-[minmax(5.5rem,7rem)_3.5rem_minmax(0,1fr)_minmax(0,1fr)] md:items-center md:gap-x-3">
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
                <div className="hidden">
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
                  <div className="hidden">
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
                <div className="hidden md:grid md:grid-cols-[minmax(5.5rem,7rem)_3.5rem_minmax(0,1fr)_minmax(0,1fr)] md:items-center md:gap-x-3">
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
        </div>
        <Sheet
          open={daySheet != null}
          onOpenChange={(next) => { if (!next) setDaySheet(null); }}
          title={daySheet ? DAY_LABELS[daySheet] : "Day"}
        >
          {daySheet ? (
            <div className="space-y-3">
              <div className="flex min-h-11 items-center justify-between gap-3">
                <span className="text-body font-medium text-ink">Open</span>
                <ToolSwitch
                  checked={Boolean(hoursSchedule.days[daySheet])}
                  onChange={(next) => setDayOpen(daySheet, next)}
                  label={`${DAY_LABELS[daySheet]} open`}
                />
              </div>
              {hoursSchedule.days[daySheet] ? (
                <div className="grid grid-cols-2 gap-2">
                  <label className="block text-meta text-ink-2">
                    Opens
                    <input
                      type="time"
                      value={hoursSchedule.days[daySheet]?.open || ""}
                      onChange={(e) => setDayTime(daySheet, "open", e.target.value)}
                      className="mt-1 min-h-11 w-full rounded-xl border border-hairline bg-surface px-3 text-body text-ink"
                    />
                  </label>
                  <label className="block text-meta text-ink-2">
                    Closes
                    <input
                      type="time"
                      value={hoursSchedule.days[daySheet]?.close || ""}
                      onChange={(e) => setDayTime(daySheet, "close", e.target.value)}
                      className="mt-1 min-h-11 w-full rounded-xl border border-hairline bg-surface px-3 text-body text-ink"
                    />
                  </label>
                </div>
              ) : null}
              <button
                type="button"
                className="inline-flex min-h-11 items-center text-body font-medium text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                onClick={() => copyDayToWeekdays(daySheet)}
              >
                Copy to weekdays
              </button>
            </div>
          ) : null}
        </Sheet>
      </section>

      <section
        className={panel === "locations" ? "space-y-3" : "hidden"}
      >
        <SettingsGroup title="Your premises">
          <div data-no-premises="" className="space-y-2 px-4 py-3">
            <SegmentedControl
              label="How customers reach you"
              value={noPremises ? "go" : "come"}
              onChange={(next) => setNoPremises(next === "go")}
              className="grid w-full grid-cols-1 gap-1 sm:grid-cols-2 [&_button]:min-h-11 [&_button]:whitespace-normal"
              items={[
                { value: "come", label: "Customers come to us" },
                { value: "go", label: "We go to customers" },
              ]}
            />
            <p className="text-meta text-ink-2">
              {noPremises
                ? "No shop or office. Callers are not sent to a place."
                : "Callers can visit you."}
            </p>
            {!noPremises && Array.isArray((policies as { coverage_areas?: unknown }).coverage_areas) && (policies as { coverage_areas: unknown[] }).coverage_areas.length > 0 ? (
              <p className="text-meta text-warn">
                <Link href="/settings/areas" className="underline">Service areas say you go to customers.</Link>
              </p>
            ) : null}
          </div>
        </SettingsGroup>
        <PlacesEditor
          value={locations}
          title={noPremises ? "Your base (optional)" : locations.length > 1 ? "Branches" : "Your places"}
          hint={
            noPremises
              ? "For reference only. Callers are not sent here."
              : locations.length > 1
                ? "Your Business Assistant sends callers to the nearest branch."
                : undefined
          }
          businessHours={formatHoursForOwner(hoursSchedule)}
          canEdit={canEditSettings}
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
            legacyText={ownerLegacy("payment")}
            quoteSource={!starterKeys.has("payment")}
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
                hint="Off: callers ask for a time and you confirm it. On: your Business Assistant notes the time they ask for, and you confirm it."
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
              <SettingsRow label="Hold items for customers" control="switch" hint="Your Business Assistant can hold an item for a caller and alerts you each time.">
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
              {policies.deposit && !starterKeys.has("deposit") ? (
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

        {starterPolicies.length ? (
          <SettingsGroup title="Starter text">
            <div className="space-y-3 px-4 py-3">
              <p className="text-body text-ink-2">
                We added this text to get you started. Your Business Assistant does not use it until you keep it or
                replace it with your own words.
              </p>
              {starterPolicies.map((row) => (
                <div key={row.key} className="space-y-2 border-t border-hairline pt-3 first:border-t-0 first:pt-0">
                  <p className="text-meta text-ink-2">{row.label} · not used yet</p>
                  <p className="text-body text-ink">{row.text}</p>
                  <div className="flex flex-wrap gap-2">
                    <button type="button" className={settingsGhostButtonClass} onClick={() => markPolicyOwner(row.key, false)}>
                      Keep it
                    </button>
                    <button type="button" className={settingsGhostButtonClass} onClick={() => setStarterClear(row.key)}>
                      Replace
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </SettingsGroup>
        ) : null}
        <ConfirmSheet
          open={starterClear !== null}
          title="Remove the starter text?"
          confirmLabel="Remove"
          onClose={() => setStarterClear(null)}
          onConfirm={() => {
            if (starterClear) markPolicyOwner(starterClear, true);
            setStarterClear(null);
          }}
        >
          <p className="text-body text-ink-2">
            The field will be empty so you can write your own. Callers hear that you will confirm it until you do.
          </p>
        </ConfirmSheet>

        <PolicyRulesEditor
          rules={policies.rules ?? {}}
          legacy={{
            returns: ownerLegacy("returns"),
            delivery: ownerLegacy("delivery"),
            cancellation: ownerLegacy("cancellation"),
            warranty: ownerLegacy("warranty"),
          }}
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
          <UnknownAnswerField
            text={unknownText}
            onText={setUnknownText}
            onReset={() => {
              setUnknownText(UNKNOWN_ANSWER_DEFAULT_EN);
              setSpokenEn("");
              setSpokenSw("");
              setSpokenTouched(false);
            }}
            english={spokenEn}
            swahili={spokenSw}
            updating={pending && Boolean(unknownLine) && unknownLine !== spokenSource}
            onEnglish={(value) => {
              setSpokenEn(value);
              setSpokenTouched(true);
            }}
            onSwahili={(value) => {
              setSpokenSw(value);
              setSpokenTouched(true);
            }}
          />
        </SettingsGroup>
      </section>

            <section className={panel === "tools" ? "space-y-6" : "hidden"}>
        <SettingsGroup title="On a call">
          <Link
            href={businessSettingsHref("train", "identity")}
            data-voice-moved=""
            className="flex min-h-11 w-full items-center gap-3 px-4 text-start hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand"
          >
            <span className="shrink-0 text-body font-medium text-ink">Voice</span>
            <span className="min-w-0 flex-1 truncate text-end text-body text-ink-2">
              {displaySonioxVoiceLabel(
                sonioxVoiceLabel.trim().toLowerCase() === agentName.trim().toLowerCase() ? "" : sonioxVoiceLabel,
                sonioxVoiceId,
                voiceOptions,
              )}
            </span>
            <span className="shrink-0 text-body font-medium text-accent">Change in Identity</span>
          </Link>
          <div className="space-y-1.5 px-4 py-3">
            <SettingsSegmented
              label="On a call"
              value={afterHoursMode}
              options={AFTER_HOURS_OPTIONS.map((opt) => ({
                id: opt.id,
                label: opt.label,
              }))}
              onChange={setAfterHoursMode}
            />
            <p className="text-meta text-ink-2">
              {afterHoursMode === "message"
                ? "Takes a message and ends."
                : "Answers questions, books and takes messages."}
            </p>
          </div>
        </SettingsGroup>
        <SettingsGroup title="Tools">
          {AGENT_TOOL_OPTIONS.map((opt) => {
            return (
              <SettingsRow key={opt.id} label={opt.label} control="switch">
                <ToolSwitch
                  checked={agentTools[opt.id]}
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
          <p className="px-4 pb-2 text-meta text-ink-2">
            Texts your team when a caller asks for a person.{" "}
            <Link href={businessSettingsHref("alerts")} className="font-medium text-accent">
              How we notify
            </Link>
          </p>
          <p className="px-4 pb-3 text-meta text-ink-2">
            {agentTools.end_call ? "Ends the call after goodbye." : "Stays on the line after goodbye."}
          </p>
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
            initialReview={pronunciationReview}
            initialQueueFailed={pronunciationQueueFailed}
          />
        ) : null}
      </section>

      <section className={panel === "team" ? "space-y-4" : "hidden"}>
        {membersSlot}
        {seatNoteSlot}
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
        <label className="block px-1">
          <span className="sr-only">Search FAQs</span>
          <input
            value={faqQuery}
            onChange={(e) => setFaqQuery(e.target.value)}
            placeholder="Search"
            className={settingsDenseFieldClass}
          />
        </label>
        {filledFaqCount === 0 ? (
          <Empty title="No FAQs yet" line="Add the questions callers ask most." />
        ) : null}
        <ul className="overflow-hidden rounded-2xl border border-hairline bg-surface" aria-label="FAQs" data-faq-list="">
          {faqs.map((faq, index) => {
            const filled = Boolean(faq.question.trim() && faq.answer.trim());
            if (!filled) return null;
            const q = faqQuery.trim().toLowerCase();
            if (q && !`${faq.question} ${faq.answer}`.toLowerCase().includes(q)) return null;
            return (
              <li key={`faq-${index}`} className="border-b border-hairline last:border-b-0">
                <button
                  type="button"
                  onClick={() => openFaqEditor(index)}
                  className="flex min-h-14 w-full items-center gap-3 px-4 py-2 text-start hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-body font-medium text-ink">{faq.question}</span>
                    <span className="block truncate text-meta text-ink-2">{faq.answer}</span>
                  </span>
                  <ChevronRightIcon className="size-5 shrink-0 text-ink-3" aria-hidden />
                </button>
              </li>
            );
          })}
          <li>
            <button
              type="button"
              onClick={() => openFaqEditor("new")}
              disabled={faqs.length >= FAQ_MAX}
              className="flex min-h-11 w-full items-center px-4 text-start text-body font-medium text-ink hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand disabled:opacity-60"
            >
              + Add FAQ
            </button>
          </li>
        </ul>
        <Sheet
          open={faqEditor != null}
          onOpenChange={(next) => { if (!next) setFaqEditor(null); }}
          title={faqEditor === "new" ? "Add FAQ" : "FAQ"}
          footer={
            <Button type="button" onClick={saveFaqEditor} disabled={!faqDraft.question.trim() || !faqDraft.answer.trim()}>
              Save
            </Button>
          }
        >
          <div className="space-y-3">
            <label className="block text-meta text-ink-2" htmlFor="faq-sheet-q">
              Question
              <AutoGrowTextarea
                id="faq-sheet-q"
                rows={2}
                maxLength={FAQ_QUESTION_MAX}
                value={faqDraft.question}
                placeholder="Do you deliver on Sundays?"
                onChange={(e) => setFaqDraft((prev) => ({ ...prev, question: e.target.value }))}
                className={`${settingsDenseFieldClass} mt-1`}
              />
            </label>
            <label className="block text-meta text-ink-2" htmlFor="faq-sheet-a">
              Answer
              <AutoGrowTextarea
                id="faq-sheet-a"
                rows={3}
                maxLength={FAQ_ANSWER_MAX}
                value={faqDraft.answer}
                placeholder="Write it the way you would say it on the phone."
                onChange={(e) => setFaqDraft((prev) => ({ ...prev, answer: e.target.value }))}
                className={`${settingsDenseFieldClass} mt-1`}
              />
            </label>
            {typeof faqEditor === "number" ? (
              <button type="button" className="inline-flex min-h-11 items-center text-body font-medium text-attention" onClick={() => setFaqRemove(faqEditor)}>
                Remove
              </button>
            ) : null}
          </div>
        </Sheet>
        <ConfirmSheet
          open={faqRemove != null}
          title="Remove this FAQ?"
          confirmLabel="Remove"
          danger
          onClose={() => setFaqRemove(null)}
          onConfirm={() => { if (faqRemove != null) confirmRemoveFaq(faqRemove); }}
        >
          It leaves the list. You can undo.
        </ConfirmSheet>
      </section>
      </div>
      <SettingsActionBar
        changes={changes}
        pending={pending}
        saved={justSaved}
        note={
          removalOnly
            ? `Remove ${pendingRemovals} ${pendingRemovals === 1 ? "word" : "words"}`
            : null
        }
      />

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
