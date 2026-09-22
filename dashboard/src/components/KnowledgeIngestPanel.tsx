"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { TenantRow } from "@/lib/supabase";
import type { IngestDraft } from "@/lib/ingest/extract";
import { FAQ_ANSWER_MAX, FAQ_QUESTION_MAX } from "@/lib/faqs";
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
  settingsPrimaryButtonClass,
  compactTextareaExpandHandlers,
} from "@/components/settingsUi";

const fieldClass = settingsFieldClass;

const extractInitial: IngestExtractState = {};
const applyInitial: IngestApplyState = {};

type SourceMode = "paste" | "url";

export function KnowledgeIngestPanel({ tenant }: { tenant: TenantRow }) {
  const router = useRouter();
  const [mode, setMode] = useState<SourceMode>("paste");
  const [paste, setPaste] = useState("");
  const [url, setUrl] = useState("");
  const [draft, setDraft] = useState<IngestDraft | null>(null);
  const [selectedServices, setSelectedServices] = useState<Set<number>>(new Set());
  const [selectedFaqs, setSelectedFaqs] = useState<Set<number>>(new Set());
  const [selectedTeam, setSelectedTeam] = useState<Set<number>>(new Set());
  const [includeUnknown, setIncludeUnknown] = useState(true);
  const [includeLocations, setIncludeLocations] = useState(true);
  const [includeHours, setIncludeHours] = useState(true);
  const [includePolicies, setIncludePolicies] = useState(true);
  const [includeVertical, setIncludeVertical] = useState(true);
  const [includeContactPhone, setIncludeContactPhone] = useState(true);
  const [renameBusiness, setRenameBusiness] = useState(false);
  const [mergeMode, setMergeMode] = useState<"merge" | "replace_services_faqs">("merge");

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
      setSelectedServices(new Set(extractState.draft.services.map((_, i) => i)));
      setSelectedFaqs(new Set(extractState.draft.faqs.map((_, i) => i)));
      setSelectedTeam(new Set(extractState.draft.team.map((_, i) => i)));
      setIncludeUnknown(Boolean(extractState.draft.unknownAnswerFallback));
      setIncludeLocations(Boolean(extractState.draft.locations?.length));
      setIncludeHours(
        Boolean(extractState.draft.hoursNotes || extractState.draft.hoursSchedule)
      );
      setIncludePolicies(
        Boolean(
          extractState.draft.policies &&
            Object.values(extractState.draft.policies).some((v) =>
              String(v || "").trim()
            )
        )
      );
      setIncludeVertical(Boolean(extractState.draft.vertical));
      setIncludeContactPhone(Boolean(extractState.draft.contactPhone));
      setRenameBusiness(false);
      // For a full business brief, default to start fresh so headings/junk don't linger.
      const looksLikeBrief =
        Boolean(extractState.draft.locations?.length) ||
        Boolean(extractState.draft.hoursNotes) ||
        (extractState.draft.faqs?.length || 0) >= 3;
      setMergeMode(looksLikeBrief ? "replace_services_faqs" : "merge");
    }
  }, [extractState]);

  useEffect(() => {
    if (applyState.ok) {
      setDraft(null);
      setPaste("");
      setUrl("");
      router.refresh();
      // Bring Train into view so the remounted form is obvious.
      window.setTimeout(() => {
        document.getElementById("train")?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
      }, 250);
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
  const selectedTeamCsv = useMemo(
    () => [...selectedTeam].sort((a, b) => a - b).join(","),
    [selectedTeam]
  );

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
    (!draft ? extractState.error || extractState.message : extractState.error);
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
                { id: "paste" as const, label: "Paste" },
                { id: "url" as const, label: "Website" },
              ] as const
            }
            onChange={setMode}
          />

          <form action={extractAction} className="space-y-3">
            <input type="hidden" name="tenant_id" value={tenant.id} />
            <input type="hidden" name="source_mode" value={mode} />

            {mode === "paste" ? (
              <div className="flex flex-col gap-1.5">
                <label className="block text-xs font-medium text-ink-soft" htmlFor="ingest_paste">
                  Text
                </label>
                <textarea
                  id="ingest_paste"
                  name="paste"
                  value={paste}
                  onChange={(e) => setPaste(e.target.value)}
                  rows={2}
                  {...compactTextareaExpandHandlers}
                  placeholder={
                    "Westlands Books, Nairobi\nMon-Sat 9am-7pm\nHome cleaning from 2,500 KES\nQ: Do you cover Westlands?\nA: Yes, same day before noon."
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
                <label className="block text-xs font-medium text-ink-soft" htmlFor="ingest_url">
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
              <p className="text-right text-xs text-ink-soft">
                Scanning
              </p>
            ) : null}
          </form>
        </div>
      ) : (
        <div className="space-y-5">
          <div className="rounded-xl border border-accent/30 bg-accent-soft px-4 py-3 text-sm text-ink">
            From <span className="font-medium">{draft.sourceLabel}</span>
            {extractState.message ? (
              <span className="mt-1 block text-ink-soft">{extractState.message}</span>
            ) : null}
          </div>

          {(draft.vertical ||
            draft.businessNameSuggestion ||
            draft.locations?.length ||
            draft.hoursNotes ||
            draft.hoursSchedule ||
            draft.contactPhone ||
            (draft.policies &&
              Object.values(draft.policies).some((v) =>
                String(v || "").trim()
              ))) ? (
            <SettingsGroup title="Business details">
                {draft.businessNameSuggestion ? (
                  <SettingsRow
                    label="Rename business to"
                    hint={draft.businessNameSuggestion}
                    control="switch"
                  >
                    <ToolSwitch
                      checked={renameBusiness}
                      onChange={setRenameBusiness}
                      label="Rename business from import"
                    />
                  </SettingsRow>
                ) : null}
                {draft.vertical ? (
                  <SettingsRow
                    label="Business type"
                    hint={draft.vertical}
                    control="switch"
                  >
                    <ToolSwitch
                      checked={includeVertical}
                      onChange={setIncludeVertical}
                      label="Apply business type"
                    />
                  </SettingsRow>
                ) : null}
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
                      draft.hoursNotes ||
                      "Weekly schedule extracted from the brief"
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
                {draft.contactPhone ? (
                  <SettingsRow
                    label="Sales / WhatsApp phone"
                    hint={draft.contactPhone}
                    control="switch"
                  >
                    <ToolSwitch
                      checked={includeContactPhone}
                      onChange={setIncludeContactPhone}
                      label="Apply contact phone"
                    />
                  </SettingsRow>
                ) : null}
            </SettingsGroup>
          ) : null}

          {draft.services.length ? (
            <SettingsGroup
              title="Services"
              action={
                <button
                  type="button"
                  className="text-xs font-medium text-accent-deep"
                  onClick={() =>
                    setSelectedServices(
                      selectedServices.size === draft.services.length
                        ? new Set()
                        : new Set(draft.services.map((_, i) => i))
                    )
                  }
                >
                  {selectedServices.size === draft.services.length
                    ? "Clear all"
                    : "Select all"}
                </button>
              }
            >
                {draft.services.map((s, i) => (
                  <SettingsRow
                    key={`svc-${i}`}
                    label={s.name}
                    hint={[s.price_range, s.notes].filter(Boolean).join(" · ")}
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
                <button
                  type="button"
                  className="text-xs font-medium text-accent-deep"
                  aria-label={
                    selectedFaqs.size === draft.faqs.length
                      ? `Clear all ${draft.faqs.length} FAQs`
                      : `Select all ${draft.faqs.length} FAQs`
                  }
                  onClick={() =>
                    setSelectedFaqs(
                      selectedFaqs.size === draft.faqs.length
                        ? new Set()
                        : new Set(draft.faqs.map((_, i) => i))
                    )
                  }
                >
                  {selectedFaqs.size === draft.faqs.length ? "Clear all" : "Select all"}
                </button>
              }
            >
                {draft.faqs.map((f, i) => (
                  <div key={`faq-${i}`} className="space-y-2 px-4 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-medium text-ink">FAQ {i + 1}</p>
                      <ToolSwitch
                        checked={selectedFaqs.has(i)}
                        onChange={() => toggle(selectedFaqs, i, setSelectedFaqs)}
                        label={`Keep FAQ ${f.question || i + 1}`}
                      />
                    </div>
                    <div>
                      <label
                        className="block text-xs font-medium text-ink-soft"
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
                        className="mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none placeholder:text-ink-soft/70 focus:border-accent focus:ring-2 focus:ring-accent/40"
                      />
                    </div>
                    <div>
                      <label
                        className="block text-xs font-medium text-ink-soft"
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
                        className="mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink leading-relaxed outline-none placeholder:text-ink-soft/70 focus:border-accent focus:ring-2 focus:ring-accent/40"
                      />
                    </div>
                  </div>
                ))}
            </SettingsGroup>
          ) : null}

          {draft.team.length ? (
            <SettingsGroup title="Team">
                {draft.team.map((t, i) => (
                  <SettingsRow
                    key={`team-${i}`}
                    label={t.name}
                    hint={
                      [t.role, t.phone, t.email].filter(Boolean).join(" · ") ||
                      "No contact yet"
                    }
                    control="switch"
                  >
                    <ToolSwitch
                      checked={selectedTeam.has(i)}
                      onChange={() => toggle(selectedTeam, i, setSelectedTeam)}
                      label={`Keep teammate ${t.name}`}
                    />
                  </SettingsRow>
                ))}
            </SettingsGroup>
          ) : null}

          {draft.unknownAnswerFallback ? (
            <SettingsGroup title="When unsure">
              <SettingsRow
                label="If we don't offer something, say"
                hint={draft.unknownAnswerFallback}
                control="switch"
              >
                <ToolSwitch
                  checked={includeUnknown}
                  onChange={setIncludeUnknown}
                  label="If we don't offer something, say"
                />
              </SettingsRow>
            </SettingsGroup>
          ) : null}

          <div className="space-y-1.5">
            <p className="px-1 text-xs font-bold uppercase tracking-wide text-gray-500">
              Keep or replace
            </p>
            <SettingsSegmented
              label="Keep your current list, or start fresh?"
              value={mergeMode}
              options={
                [
                  { id: "merge" as const, label: "Keep my current list" },
                  { id: "replace_services_faqs" as const, label: "Start fresh" },
                ] as const
              }
              onChange={setMergeMode}
            />
          </div>

          <form action={applyAction} className="flex flex-wrap gap-2">
            <input type="hidden" name="tenant_id" value={tenant.id} />
            <input type="hidden" name="draft_json" value={JSON.stringify(draft)} />
            <input type="hidden" name="selected_services" value={selectedServiceCsv} />
            <input type="hidden" name="selected_faqs" value={selectedFaqCsv} />
            <input type="hidden" name="selected_team" value={selectedTeamCsv} />
            <input type="hidden" name="merge_mode" value={mergeMode} />
            <input
              type="hidden"
              name="include_unknown"
              value={includeUnknown ? "1" : "0"}
            />
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
            <input
              type="hidden"
              name="include_vertical"
              value={includeVertical ? "1" : "0"}
            />
            <input
              type="hidden"
              name="include_contact_phone"
              value={includeContactPhone ? "1" : "0"}
            />
            <input
              type="hidden"
              name="rename_business"
              value={renameBusiness ? "1" : "0"}
            />
            <button
              type="submit"
              disabled={
                applyPending ||
                (selectedServices.size === 0 &&
                  selectedFaqs.size === 0 &&
                  selectedTeam.size === 0 &&
                  !includeUnknown &&
                  !includeLocations &&
                  !includeHours &&
                  !includePolicies &&
                  !includeVertical &&
                  !includeContactPhone &&
                  !renameBusiness)
              }
              className={settingsPrimaryButtonClass}
            >
              {applyPending ? "Adding…" : "Add to my assistant"}
            </button>
            <button
              type="button"
              disabled={applyPending}
              onClick={() => setDraft(null)}
              className={settingsActionClass}
            >
              Start over
            </button>
          </form>
        </div>
      )}

      {flash ? (
        <p
          className={[
            "text-sm",
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
