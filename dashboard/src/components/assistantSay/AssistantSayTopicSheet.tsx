"use client";

import { useEffect, useMemo, useState, useTransition, type ReactNode } from "react";
import { ChevronDownIcon, SpeakerWaveIcon } from "@heroicons/react/20/solid";
import { previewDeskLookupAction, saveUnknownAnswerByKindAction } from "@/app/(desk)/settings/assistantSayActions";
import type { DeskLookupPreviewResult } from "@/app/(desk)/settings/assistantSayActions";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Sheet } from "@/components/ui/Sheet";
import { Stamp } from "@/components/ui/Stamp";
import { SegmentedControl } from "@/components/ui/Segmented";
import { settingsFieldClass, SettingsStack } from "@/components/settingsUi";
import { useFormDraft, useFormSave } from "@/components/useFormSave";
import type { LookupPreviewSamples } from "@/lib/assistantSayVoice.server";
import type { AssistantSayRow } from "@/lib/assistantSayTypes";
import { editCtaLabel, fallbackKindForTopic } from "@/lib/assistantSayTopics";
import type { BusinessType } from "@/lib/businessType";
import { deskConfirmHaptic } from "@/lib/deskFeel";
import { cx } from "@/lib/cx";
import {
  buildGreetingSentence,
  greetingLanguagePickFromStored,
  resolveGreetingLanguage,
} from "@/lib/identityGreeting";
import { lexiconForStorage, parseTtsLexicon } from "@/lib/pronunciationLexicon";
import { assertPreviewAudioPlayable, objectUrlFromPreviewResponse, previewErrorCopy } from "@/lib/previewAudio";
import { listCuratedSonioxVoicesSync, resolveLiveCallVoiceId } from "@/lib/sonioxVoiceCatalog";
import type { TenantRow } from "@/lib/supabase";
import {
  FALLBACK_KIND_LABELS,
  FALLBACK_KINDS,
  spokenFallbackLine,
  type FallbackKind,
  type UnknownAnswerByKind,
} from "@/lib/unknownAnswerByKindConstants";

const fieldClass = `${settingsFieldClass} min-h-11`;

type FallbackSaveState = { ok?: boolean; error?: string | null; byKind?: UnknownAnswerByKind | null };

async function saveFallbacks(_prev: FallbackSaveState, formData: FormData): Promise<FallbackSaveState> {
  return saveUnknownAnswerByKindAction(formData);
}

function sampleForTopic(topicId: string, samples: LookupPreviewSamples): string {
  if (topicId === "prices") return samples.price;
  if (topicId === "hours") return samples.hours;
  if (topicId === "areas") return samples.delivery;
  if (topicId === "payment") return samples.pay;
  return "";
}

function CollapsibleSection({
  title,
  defaultOpen = false,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-t border-hairline pt-4">
      <button
        type="button"
        className="flex min-h-11 w-full items-center justify-between gap-2 text-start"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="text-body font-medium text-ink">{title}</span>
        <ChevronDownIcon
          className={cx("size-5 shrink-0 text-ink-3 motion-reduce:transition-none transition-transform", open && "rotate-180")}
          aria-hidden="true"
        />
      </button>
      {open ? <div className="mt-3 space-y-3">{children}</div> : null}
    </div>
  );
}

export function AssistantSayTopicSheet({
  row,
  open,
  onOpenChange,
  samples,
  tenant,
  businessType,
  initialByKind,
  legacyGeneral,
  lookupKind,
  fixHref,
  onSaved,
}: {
  row: AssistantSayRow;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  samples: LookupPreviewSamples;
  tenant: TenantRow;
  businessType: BusinessType;
  initialByKind: UnknownAnswerByKind | null;
  legacyGeneral?: string | null;
  lookupKind: string;
  fixHref: string;
  onSaved: () => void;
}) {
  const [lang, setLang] = useState<"en" | "sw">("en");
  const [preview, setPreview] = useState<DeskLookupPreviewResult | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [pendingPreview, startPreview] = useTransition();
  const [query, setQuery] = useState(() => sampleForTopic(row.id, samples));
  const [hearLoading, setHearLoading] = useState(false);
  const [hearError, setHearError] = useState<string | null>(null);
  const [byKind, setByKind] = useState<UnknownAnswerByKind | null>(initialByKind);
  const fallbackKinds = useMemo((): FallbackKind[] => {
    if (row.id === "unsure") return [...FALLBACK_KINDS];
    const kind = fallbackKindForTopic(row.id);
    return kind ? [kind] : [];
  }, [row.id]);

  const save = useFormSave<FallbackSaveState>({
    action: saveFallbacks,
    initialState: { ok: true },
    successMessage: "Saved",
    formId: `assistant-say-sheet-${row.id}`,
    onLanded: (result) => {
      if (result.ok) {
        deskConfirmHaptic();
        if (result.byKind !== undefined) setByKind(result.byKind ?? null);
        onSaved();
      }
    },
  });
  const { pending: savePending } = save;
  const [adopted, setAdopted] = useState(save.state);
  if (adopted !== save.state) {
    setAdopted(save.state);
    if (save.state.ok && save.state.byKind !== undefined) setByKind(save.state.byKind ?? null);
  }

  const values = useMemo(() => {
    const out: Record<string, { en: string; sw: string }> = {};
    for (const kind of FALLBACK_KINDS) {
      const enCustom = byKind?.[kind]?.en?.trim();
      const swCustom = byKind?.[kind]?.sw?.trim();
      out[kind] = {
        en: enCustom || spokenFallbackLine(kind, byKind, "en", legacyGeneral, businessType),
        sw: swCustom || spokenFallbackLine(kind, byKind, "sw", legacyGeneral, businessType),
      };
    }
    return out;
  }, [byKind, legacyGeneral, businessType]);

  const draftValues = useMemo(() => {
    const slice: Record<string, { en: string; sw: string }> = {};
    for (const kind of fallbackKinds) slice[kind] = values[kind];
    return slice;
  }, [fallbackKinds, values]);

  const { dirty, justSaved } = useFormDraft(save, {
    id: `assistant-say-sheet-${row.id}`,
    values: draftValues,
    adoptsResult: true,
  });

  const greetingSentence = useMemo(() => {
    if (row.id !== "greeting") return null;
    const pick = greetingLanguagePickFromStored(tenant.greeting_language);
    const language = resolveGreetingLanguage(pick, tenant.greeting_invite, tenant.greeting_text);
    return buildGreetingSentence({
      businessName: tenant.business_name,
      spokenName: tenant.spoken_name,
      agentName: tenant.agent_name,
      greetingInvite: tenant.greeting_invite,
      greetingText: tenant.greeting_text,
      language,
    });
  }, [row.id, tenant]);

  useEffect(() => {
    if (!open || row.id === "greeting" || row.id === "unsure") return;
    const sample = sampleForTopic(row.id, samples);
    setQuery(sample);
    startPreview(async () => {
      const res = await previewDeskLookupAction(lookupKind, sample);
      if (res.ok) {
        setPreview(res.result);
        setPreviewError(null);
      } else {
        setPreview(null);
        setPreviewError(res.error);
      }
    });
  }, [open, row.id, lookupKind, samples]);

  const callersLineEn =
    preview?.speechEn ||
    (row.id === "greeting" ? greetingSentence?.text : row.hearPreview) ||
    spokenFallbackLine("general", byKind, "en", legacyGeneral, businessType);
  const callersLineSw =
    preview?.speechSw ||
    (row.id === "greeting" ? "" : spokenFallbackLine(fallbackKinds[0] || "general", byKind, "sw", legacyGeneral, businessType));

  const displayLine = lang === "sw" && callersLineSw ? callersLineSw : callersLineEn;

  async function hearLine() {
    setHearLoading(true);
    setHearError(null);
    try {
      const voices = listCuratedSonioxVoicesSync();
      const voiceId = resolveLiveCallVoiceId(tenant.soniox_voice_id, voices);
      const language = lang === "sw" ? "sw" : "en";
      const text = displayLine;
      const res = await fetch("/api/pronunciation/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text,
          language,
          lexicon: lexiconForStorage(parseTtsLexicon(tenant.tts_lexicon)),
          voiceId,
          ...(row.id === "greeting" ? { greeting: { tenantId: tenant.id } } : {}),
        }),
      });
      const audio = await objectUrlFromPreviewResponse(res);
      try {
        await assertPreviewAudioPlayable(audio.url);
        const el = new Audio(audio.url);
        await el.play();
      } finally {
        URL.revokeObjectURL(audio.url);
      }
    } catch (err) {
      setHearError(previewErrorCopy(err));
    } finally {
      setHearLoading(false);
    }
  }

  function runTryQuestion() {
    startPreview(async () => {
      const res = await previewDeskLookupAction(lookupKind, query);
      if (res.ok) {
        setPreview(res.result);
        setPreviewError(null);
      } else {
        setPreview(null);
        setPreviewError(res.error);
      }
    });
  }

  const showFallback = fallbackKinds.length > 0 && row.id !== "greeting";

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={row.title}
      size="lg"
      footer={
        showFallback && dirty ? (
          <div className="flex w-full flex-wrap items-center justify-between gap-3">
            {save.error ? (
              <p className="min-w-0 flex-1 text-meta text-warn" role="alert">
                {save.error}{" "}
                <button type="button" onClick={save.retry} className="font-medium text-accent underline-offset-2 hover:underline">
                  Retry
                </button>
              </p>
            ) : (
              <span className="text-meta text-ok">{justSaved ? "Saved" : null}</span>
            )}
            <Button type="submit" form={`assistant-say-sheet-${row.id}`} variant="primary" size="md" disabled={savePending || !dirty}>
              {savePending ? "Saving" : justSaved ? "Saved" : "Save"}
            </Button>
          </div>
        ) : null
      }
    >
      <div className="space-y-4">
        <div className="rounded-2xl border border-hairline bg-surface-2 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-meta font-medium text-ink-2">Callers hear</p>
            <div className="flex flex-wrap items-center gap-2">
              <SegmentedControl
                label="Language"
                value={lang}
                onChange={(v) => setLang(v as "en" | "sw")}
                items={[
                  { value: "en", label: "EN" },
                  { value: "sw", label: "SW" },
                ]}
              />
              <Button
                type="button"
                variant="tonal"
                size="md"
                pending={hearLoading}
                leading={<SpeakerWaveIcon className="size-4" aria-hidden="true" />}
                onClick={() => void hearLine()}
              >
                Hear it
              </Button>
            </div>
          </div>
          <p className="mt-3 text-body text-ink [overflow-wrap:anywhere]">&ldquo;{displayLine}&rdquo;</p>
          {hearError ? <p className="mt-2 text-meta text-attention">{hearError}</p> : null}
          {lang === "en" && callersLineSw ? (
            <p className="mt-2 text-meta text-ink-3 [overflow-wrap:anywhere]" lang="sw">
              {callersLineSw}
            </p>
          ) : null}
          {preview ? (
            <div className="mt-3 flex items-center gap-2">
              <Stamp tone={preview.stampTone}>{preview.stampLabel}</Stamp>
            </div>
          ) : (
            <div className="mt-3 flex items-center gap-2">
              <Stamp tone={row.stampTone}>{row.stampLabel}</Stamp>
            </div>
          )}
        </div>

        {row.id !== "unsure" ? (
          <div className="space-y-2">
            <p className="text-meta text-ink-2">{row.reason}</p>
            {row.id !== "greeting" ? (
              <ButtonLink href={fixHref} variant="primary" size="md" className="w-full sm:w-auto">
                {editCtaLabel(row.id)}
              </ButtonLink>
            ) : (
              <ButtonLink href={fixHref} variant="primary" size="md" className="w-full sm:w-auto">
                {editCtaLabel("greeting")}
              </ButtonLink>
            )}
          </div>
        ) : (
          <p className="text-meta text-ink-2">
            Fallback lines only offer a callback. They never promise a transfer, a booking slot, or open today.
          </p>
        )}

        {showFallback ? (
          <form id={`assistant-say-sheet-${row.id}`} onSubmit={save.onSubmit}>
            <CollapsibleSection title="If it doesn't know" defaultOpen={row.id === "unsure"}>
              {fallbackKinds.map((kind) => (
                <div key={kind} className="space-y-3">
                  {row.id === "unsure" && kind !== "general" ? (
                    <p className="text-body font-medium text-ink">{FALLBACK_KIND_LABELS[kind]}</p>
                  ) : null}
                  <SettingsStack label="English" htmlFor={`fallback_${kind}_en`}>
                    <textarea
                      id={`fallback_${kind}_en`}
                      name={`fallback_${kind}_en`}
                      rows={2}
                      maxLength={220}
                      className={fieldClass}
                      value={values[kind].en}
                      onChange={(e) =>
                        setByKind((prev) => ({
                          ...(prev || {}),
                          [kind]: { ...values[kind], en: e.target.value },
                        }))
                      }
                    />
                  </SettingsStack>
                  <CollapsibleSection title="Kiswahili line">
                    <SettingsStack label="Kiswahili" htmlFor={`fallback_${kind}_sw`}>
                      <textarea
                        id={`fallback_${kind}_sw`}
                        name={`fallback_${kind}_sw`}
                        lang="sw"
                        rows={2}
                        maxLength={220}
                        className={fieldClass}
                        value={values[kind].sw}
                        onChange={(e) =>
                          setByKind((prev) => ({
                            ...(prev || {}),
                            [kind]: { ...values[kind], sw: e.target.value },
                          }))
                        }
                      />
                    </SettingsStack>
                  </CollapsibleSection>
                </div>
              ))}
            </CollapsibleSection>
          </form>
        ) : null}

        {row.id !== "greeting" && row.id !== "unsure" ? (
          <CollapsibleSection title="Try a question">
            <SettingsStack label="Question" htmlFor="assistant_say_try_query">
              <input
                id="assistant_say_try_query"
                className={fieldClass}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={sampleForTopic(row.id, samples) || "Ask something callers might say"}
              />
            </SettingsStack>
            <Button type="button" variant="tonal" size="md" onClick={runTryQuestion} disabled={pendingPreview}>
              {pendingPreview ? "Showing" : "Show answer"}
            </Button>
            {previewError ? <p className="text-meta text-attention">{previewError}</p> : null}
          </CollapsibleSection>
        ) : null}
      </div>
    </Sheet>
  );
}
