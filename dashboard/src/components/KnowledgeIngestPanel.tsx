"use client";

import { withRoleGate } from "@/components/DeskRole";
import { useActionState, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { KNOWLEDGE_PASTE_POOLS, placeholderPool } from "@/lib/deskPlaceholders";
import { useMountedPoolPick } from "@/lib/useMountedPoolPick";
import type { TenantRow } from "@/lib/supabase";
import { parseVertical } from "@/lib/vertical";
import { structureImportedCatalogRow } from "@/lib/catalogPricingMode";
import { catalogImportPriceHintText } from "@/components/settings/catalog/CatalogImportPriceLine";
import type { IngestDraft } from "@/lib/ingest/extract";
import { FAQ_ANSWER_MAX, FAQ_QUESTION_MAX } from "@/lib/faqs";
import { formatHoursForCompiler } from "@/lib/hoursSchedule";
import {
  applyIngestAction,
  extractKnowledgeAction,
  type IngestApplyState,
  type IngestExtractState,
} from "@/app/(desk)/settings/ingestActions";
import {
  SettingsGroup,
  SettingsRow,
  SettingsSegmented,
  ToolSwitch,
  settingsActionClass,
  settingsFieldClass,
  settingsGhostButtonClass,
  settingsPrimaryButtonClass,
  compactTextareaExpandHandlers,
} from "@/components/settingsUi";

const fieldClass = settingsFieldClass;

function ListSelectAll({
  selected,
  total,
  noun,
  onClear,
  onSelectAll,
}: {
  selected: number;
  total: number;
  noun: string;
  onClear: () => void;
  onSelectAll: () => void;
}) {
  const allOn = selected > 0 && selected === total;
  const label = allOn ? "Clear all" : "Select all";
  return (
    <button
      type="button"
      className={settingsGhostButtonClass}
      aria-label={allOn ? `Clear all ${total} ${noun}` : `Select all ${total} ${noun}`}
      onClick={allOn ? onClear : onSelectAll}
    >
      {label}
    </button>
  );
}

const extractInitial: IngestExtractState = {};
const applyInitial: IngestApplyState = {};

type SourceMode = "text" | "url" | "csv";

function ingestServicePriceHint(service: { price_range?: string; notes?: string }): string {
  const structured = structureImportedCatalogRow(
    {
      name: "",
      price_range: service.price_range ?? "",
      notes: "",
      out_of_scope: "",
      in_stock: "",
      category: "",
    },
    "price_range"
  );
  return [catalogImportPriceHintText(structured), service.notes].filter(Boolean).join(" · ");
}

function serviceCsvPlaceholder(vertical: string | null | undefined): string {
  if (parseVertical(vertical) === "retail") {
    return "name,price\nA4 paper,500 KES\nBinding,300 KES";
  }
  return "name,price\nHome cleaning,2500 KES\nSofa cleaning,1500 KES";
}

function KnowledgeIngestPanelInner({ tenant }: { tenant: TenantRow }) {
  const router = useRouter();
  const knowledgePasteExample = useMountedPoolPick(
    placeholderPool(KNOWLEDGE_PASTE_POOLS, parseVertical(tenant.vertical))
  );
  const [mode, setMode] = useState<SourceMode>("text");
  const [paste, setPaste] = useState("");
  const [url, setUrl] = useState("");
  const [draft, setDraft] = useState<IngestDraft | null>(null);
  const [selectedServices, setSelectedServices] = useState<Set<number>>(new Set());
  const [selectedFaqs, setSelectedFaqs] = useState<Set<number>>(new Set());
  const [includeLocations, setIncludeLocations] = useState(false);
  const [includeHours, setIncludeHours] = useState(false);
  const [includePolicies, setIncludePolicies] = useState(false);
  const [mergeMode, setMergeMode] = useState<"merge" | "replace_services_faqs">("merge");
  const [dismissedExtract, setDismissedExtract] = useState<IngestExtractState | null>(null);

  const [extractState, extractAction, extractPending] = useActionState(
    extractKnowledgeAction,
    extractInitial
  );
  const [applyState, applyAction, applyPending] = useActionState(
    applyIngestAction,
    applyInitial
  );

  useEffect(() => {
    if (extractState.ok && extractState.draft) {
      setDraft(extractState.draft);
      setSelectedServices(new Set());
      setSelectedFaqs(new Set());
      // Scanned values stay on the rows. Row ticks and section switches start off.
      setIncludeLocations(false);
      setIncludeHours(false);
      setIncludePolicies(false);
      // Import only adds by default. Replacing FAQs is an explicit choice, never preselected.
      setMergeMode("merge");
    }
  }, [extractState]);

  useEffect(() => {
    if (applyState.ok) {
      setDraft(null);
      setPaste("");
      setUrl("");
      router.refresh();
    }
  }, [applyState, router]);

  const selectedServiceCsv = useMemo(
    () => [...selectedServices].sort((a, b) => a - b).join(","),
    [selectedServices]
  );
  const selectedFaqCsv = useMemo(
    () => [...selectedFaqs].sort((a, b) => a - b).join(","),
    [selectedFaqs]
  );
  const nothingSelected =
    selectedServices.size === 0 &&
    selectedFaqs.size === 0 &&
    !includeLocations &&
    !includeHours &&
    !includePolicies;

  function toggle(set: Set<number>, index: number, setter: (s: Set<number>) => void) {
    const next = new Set(set);
    if (next.has(index)) next.delete(index);
    else next.add(index);
    setter(next);
  }

  function updateDraftFaq(
    index: number,
    key: "question" | "answer",
    value: string
  ) {
    setDraft((prev) => {
      if (!prev) return prev;
      const faqs = prev.faqs.map((row, i) =>
        i === index ? { ...row, [key]: value } : row
      );
      return { ...prev, faqs };
    });
  }

  // While reviewing a draft, the extract tip already shows in the green box.
  const flash =
    applyState.error ||
    applyState.message ||
    (!draft
      ? extractState === dismissedExtract
        ? null
        : extractState.error || extractState.message
      : extractState.error);
  const flashIsError = Boolean(applyState.error || extractState.error);

  return (
    <section className="space-y-4">
      {!draft ? (
        <div className="space-y-4">
          <SettingsSegmented
            label="Import source"
            value={mode}
            options={
              [
                { id: "text" as const, label: "Text" },
                { id: "url" as const, label: "URL" },
                { id: "csv" as const, label: "CSV" },
              ] as const
            }
            onChange={setMode}
          />

          <form action={extractAction} className="space-y-3">
            <input type="hidden" name="tenant_id" value={tenant.id} />
            <input type="hidden" name="source_mode" value={mode === "url" ? "url" : "paste"} />

            {mode === "text" || mode === "csv" ? (
              <div className="flex flex-col gap-1.5">
                <label className="block text-meta font-medium text-ink-2" htmlFor="ingest_paste">
                  {mode === "csv" ? "CSV" : "Text"}
                </label>
                <textarea
                  id="ingest_paste"
                  name="paste"
                  value={paste}
                  onChange={(e) => setPaste(e.target.value)}
                  rows={2}
                  {...compactTextareaExpandHandlers}
                  placeholder={
                    mode === "csv"
                      ? serviceCsvPlaceholder(tenant.vertical)
                      : knowledgePasteExample
                  }
                  className={`${fieldClass} mt-0 leading-relaxed`}
                />
                <div className="flex justify-end self-end">
                  <button
                    type="submit"
                    disabled={extractPending}
                    className={settingsPrimaryButtonClass}
                  >
                    {extractPending ? "Scanning…" : "Scan"}
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-1.5">
                <label className="block text-meta font-medium text-ink-2" htmlFor="ingest_url">
                  URL
                </label>
                <input
                  id="ingest_url"
                  name="url"
                  type="url"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://shop.co.ke/services"
                  className={`${fieldClass} mt-0`}
                />
                <div className="flex justify-end self-end">
                  <button
                    type="submit"
                    disabled={extractPending}
                    className={settingsPrimaryButtonClass}
                  >
                    {extractPending ? "Scanning…" : "Scan"}
                  </button>
                </div>
              </div>
            )}

            {extractPending ? (
              <p className="text-right text-meta text-ink-2">
                Scanning
              </p>
            ) : null}
          </form>
        </div>
      ) : (
        <div className="space-y-5">
          <div className="rounded-xl border border-accent/30 bg-accent-soft px-4 py-3 text-body text-ink">
            From <span className="font-medium">{draft.sourceLabel}</span>
            {extractState.message ? (
              <span className="mt-1 block text-ink-2">{extractState.message}</span>
            ) : null}
          </div>

          {(draft.locations?.length ||
            draft.hoursNotes ||
            draft.hoursSchedule ||
            (draft.policies &&
              Object.values(draft.policies).some((v) =>
                String(v || "").trim()
              ))) ? (
            <SettingsGroup title="Business details">
                {draft.locations?.length ? (
                  <SettingsRow
                    label="Location"
                    hint={draft.locations
                      .map((loc) =>
                        [loc.label, loc.address, loc.landmark, loc.coverage_notes]
                          .filter(Boolean)
                          .join(" · ")
                      )
                      .join(" · ")}
                    control="switch"
                  >
                    <ToolSwitch
                      checked={includeLocations}
                      onChange={setIncludeLocations}
                      label="Apply location"
                    />
                  </SettingsRow>
                ) : null}
                {draft.hoursNotes || draft.hoursSchedule ? (
                  <SettingsRow
                    label="Hours"
                    hint={
                      draft.hoursNotes?.trim() ||
                      formatHoursForCompiler(draft.hoursSchedule ?? null).trim() ||
                      undefined
                    }
                    control="switch"
                  >
                    <ToolSwitch
                      checked={includeHours}
                      onChange={setIncludeHours}
                      label="Apply hours"
                    />
                  </SettingsRow>
                ) : null}
                {draft.policies &&
                Object.values(draft.policies).some((v) =>
                  String(v || "").trim()
                ) ? (
                  <SettingsRow
                    label="Policies"
                    hint={Object.entries(draft.policies)
                      .filter(([, v]) => String(v || "").trim())
                      .map(([k, v]) => `${k}: ${v}`)
                      .join(" · ")}
                    control="switch"
                  >
                    <ToolSwitch
                      checked={includePolicies}
                      onChange={setIncludePolicies}
                      label="Apply policies"
                    />
                  </SettingsRow>
                ) : null}
            </SettingsGroup>
          ) : null}

          {draft.services.length ? (
            <SettingsGroup
              title="Services"
              action={
                <ListSelectAll
                  selected={selectedServices.size}
                  total={draft.services.length}
                  noun="services"
                  onClear={() => setSelectedServices(new Set())}
                  onSelectAll={() =>
                    setSelectedServices(new Set(draft.services.map((_, i) => i)))
                  }
                />
              }
            >
                {draft.services.map((s, i) => (
                  <SettingsRow
                    key={`svc-${i}`}
                    label={s.name}
                    hint={ingestServicePriceHint(s)}
                    control="switch"
                  >
                    <ToolSwitch
                      checked={selectedServices.has(i)}
                      onChange={() =>
                        toggle(selectedServices, i, setSelectedServices)
                      }
                      label={`Keep service ${s.name}`}
                    />
                  </SettingsRow>
                ))}
            </SettingsGroup>
          ) : null}

          {draft.faqs.length ? (
            <SettingsGroup
              title="FAQs"
              action={
                <ListSelectAll
                  selected={selectedFaqs.size}
                  total={draft.faqs.length}
                  noun="FAQs"
                  onClear={() => setSelectedFaqs(new Set())}
                  onSelectAll={() =>
                    setSelectedFaqs(new Set(draft.faqs.map((_, i) => i)))
                  }
                />
              }
            >
                {draft.faqs.map((f, i) => (
                  <div key={`faq-${i}`} className="space-y-2 px-4 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-body font-medium text-ink">FAQ {i + 1}</p>
                      <ToolSwitch
                        checked={selectedFaqs.has(i)}
                        onChange={() => toggle(selectedFaqs, i, setSelectedFaqs)}
                        label={`Keep FAQ ${f.question || i + 1}`}
                      />
                    </div>
                    <div>
                      <label
                        className="block text-meta font-medium text-ink-2"
                        htmlFor={`ingest-faq-q-${i}`}
                      >
                        Question
                      </label>
                      <input
                        id={`ingest-faq-q-${i}`}
                        value={f.question}
                        maxLength={FAQ_QUESTION_MAX}
                        onChange={(e) =>
                          updateDraftFaq(i, "question", e.target.value)
                        }
                        className="mt-1 w-full rounded-lg border border-hairline bg-surface px-3 py-2 text-body text-ink outline-none placeholder:text-ink-2/70 focus:border-accent focus:ring-2 focus:ring-accent/40"
                      />
                    </div>
                    <div>
                      <label
                        className="block text-meta font-medium text-ink-2"
                        htmlFor={`ingest-faq-a-${i}`}
                      >
                        Answer
                      </label>
                      <textarea
                        id={`ingest-faq-a-${i}`}
                        value={f.answer}
                        maxLength={FAQ_ANSWER_MAX}
                        rows={2}
                        onChange={(e) =>
                          updateDraftFaq(i, "answer", e.target.value)
                        }
                        className="mt-1 w-full rounded-lg border border-hairline bg-surface px-3 py-2 text-body text-ink leading-relaxed outline-none placeholder:text-ink-2/70 focus:border-accent focus:ring-2 focus:ring-accent/40"
                      />
                    </div>
                  </div>
                ))}
            </SettingsGroup>
          ) : null}

          <div className="space-y-1.5">
            <p className="px-1 text-meta font-medium text-ink-2">
              Keep or replace
            </p>
            <SettingsSegmented
              label="Add to your FAQs, or replace them?"
              value={mergeMode}
              options={
                [
                  { id: "merge" as const, label: "Add to what I have" },
                  { id: "replace_services_faqs" as const, label: "Replace my FAQs" },
                ] as const
              }
              onChange={setMergeMode}
            />
            <p className="px-1 text-meta text-ink-2" data-import-replace-note="">
              {mergeMode === "replace_services_faqs"
                ? "Your current FAQs are replaced by the ticked ones. Services are only added; items you already have stay as they are."
                : "Ticked items are added. Items you already have stay as they are."}
            </p>
          </div>

          <form action={applyAction} className="flex flex-wrap gap-2">
            <input type="hidden" name="tenant_id" value={tenant.id} />
            <input type="hidden" name="draft_json" value={JSON.stringify(draft)} />
            <input type="hidden" name="selected_services" value={selectedServiceCsv} />
            <input type="hidden" name="selected_faqs" value={selectedFaqCsv} />
            <input type="hidden" name="merge_mode" value={mergeMode} />
            <input
              type="hidden"
              name="include_locations"
              value={includeLocations ? "1" : "0"}
            />
            <input
              type="hidden"
              name="include_hours"
              value={includeHours ? "1" : "0"}
            />
            <input
              type="hidden"
              name="include_policies"
              value={includePolicies ? "1" : "0"}
            />
            <button
              type="submit"
              disabled={applyPending || nothingSelected}
              className={settingsPrimaryButtonClass}
            >
              {applyPending ? "Adding…" : "Add selected"}
            </button>
            <button
              type="button"
              disabled={applyPending}
              onClick={() => {
                setDismissedExtract(extractState);
                setDraft(null);
              }}
              className={settingsActionClass}
            >
              Start over
            </button>
            {nothingSelected ? (
              <p className="w-full text-body text-ink">Select what to add.</p>
            ) : null}
          </form>
        </div>
      )}

      {flash ? (
        <p
          className={[
            "text-body",
            flashIsError ? "text-warn" : "text-accent-deep",
          ].join(" ")}
          role={flashIsError ? "alert" : "status"}
        >
          {flash}
        </p>
      ) : null}
    </section>
  );
}

export const KnowledgeIngestPanel = withRoleGate("settings.edit", KnowledgeIngestPanelInner);
