"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import { ChevronRightIcon, PlusIcon, SpeakerWaveIcon } from "@heroicons/react/20/solid";
import { useCan, withRoleGate } from "@/components/DeskRole";
import { useFormDraft, useFormSave } from "@/components/useFormSave";
import { TenantSettingsSaveButton } from "@/components/TenantSettingsSaveButton";
import { ChoiceSheet } from "@/components/ui/ChoiceSheet";
import { ConfirmSheet } from "@/components/ui/ConfirmSheet";
import { DeskSelect } from "@/components/ui/DeskSelect";
import { Button } from "@/components/ui/Button";
import { Sheet } from "@/components/ui/Sheet";
import { deskShiftClass } from "@/components/ui/deskChrome";
import {
  SettingsGroup,
  SettingsPageHeader,
  SettingsRow,
  SettingsSelect,
  settingsConsoleClass,
  settingsDenseFieldClass,
  settingsGhostButtonClass,
  settingsPanelClass,
  settingsValueFieldClass,
} from "@/components/settingsUi";
import {
  saveAndCompileSettings,
  type SettingsCompileState,
} from "@/app/(desk)/settings/actions";
import { saveBusinessCategoryAction } from "@/app/(desk)/settings/structuredActions";
import type { TenantRow } from "@/lib/supabase";
import { canonicalizeAgentTone, TONE_LABELS, TONE_OPTIONS, type OnboardingTone } from "@/lib/onboarding";
import { parseVertical } from "@/lib/vertical";
import {
  categoryWrites,
  currentCategoryChoice,
  identityCategoryChoices,
} from "@/lib/identityCategory";
import {
  GREETING_INVITE_MAX,
  GREETING_LANGUAGES,
  SPOKEN_NAME_MAX,
  autoGreetingLanguage,
  buildGreetingSentence,
  playedGreetingFromTenant,
  greetingInviteLine,
  greetingLanguageForStorage,
  greetingMode,
  greetingLanguagePickFromStored,
  resolveGreetingLanguage,
  type GreetingLanguage,
  type GreetingLanguagePick,
} from "@/lib/identityGreeting";
import {
  SOCIAL_KINDS,
  contactKindLabel,
  contactPlaceholder,
  contactRowTitle,
  formatContactValue,
  newContact,
  type ContactAddKind,
} from "@/lib/identityContacts";
import { SOCIAL_CHANNELS_MAX, normalizeSocialHandles, type SocialChannel } from "@/lib/socialHandles";
import {
  displaySonioxVoiceLabel,
  getDefaultSonioxVoiceIdSync,
  listCuratedSonioxVoicesSync,
  resolveLiveCallVoiceId,
  type CuratedSonioxVoice,
} from "@/lib/sonioxVoiceCatalog";
import { lexiconForStorage, parseTtsLexicon } from "@/lib/pronunciationLexicon";
import {
  NO_VOICE_SAMPLE_COPY,
  assertPreviewAudioPlayable,
  objectUrlFromPreviewResponse,
  previewErrorCopy,
} from "@/lib/previewAudio";
import type { IdentityCardScope } from "@/lib/settingsSaveScope";

const initial: SettingsCompileState = {};

type CardSave = ReturnType<typeof useFormSave<SettingsCompileState>>;

/**
 * One Identity card: its own form, scope and Save. The Save shows only while
 * the card has changes (and Saving / Saved after), so three cards never read
 * as one big Save.
 */
function IdentityCard({
  id,
  scope,
  tenantId,
  title,
  save,
  dirty,
  justSaved,
  canEdit,
  hidden,
  children,
  footer,
}: {
  id: string;
  scope: IdentityCardScope;
  tenantId: string;
  title: string;
  save: CardSave;
  dirty: boolean;
  justSaved: boolean;
  canEdit: boolean;
  hidden: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const showSave = canEdit && (dirty || save.pending || justSaved);
  return (
    <form
      id={id}
      data-identity-card={scope}
      data-dirty={dirty ? "" : undefined}
      onSubmit={(event: FormEvent<HTMLFormElement>) => save.onSubmit(event)}
      className="space-y-1.5"
    >
      <input type="hidden" name="id" value={tenantId} />
      <input type="hidden" name="settings_scope" value={scope} />
      {hidden}
      <SettingsGroup
        title={title}
        action={
          <span className="inline-flex min-h-11 items-center">
            {showSave ? <TenantSettingsSaveButton form={id} pending={save.pending} saved={justSaved} /> : null}
          </span>
        }
      >
        {children}
      </SettingsGroup>
      {footer}
      {save.error ? (
        <div className="flex flex-wrap items-center gap-x-3 px-1" data-save-error="">
          <p className="min-w-0 flex-1 text-body text-warn" role="alert">
            {save.error}
          </p>
          <button
            type="button"
            onClick={save.retry}
            className="min-h-11 shrink-0 rounded-xl px-2 text-body font-medium text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            Try again
          </button>
        </div>
      ) : null}
    </form>
  );
}

function useCardSave(
  formId: string,
  action: (prev: SettingsCompileState, data: FormData) => Promise<SettingsCompileState>,
  onSaveActivity?: () => void
) {
  return useFormSave<SettingsCompileState>({
    action,
    initialState: initial,
    successMessage: "Saved · training line",
    formId,
    onSaveStart: onSaveActivity,
    onLanded: onSaveActivity,
  });
}

/* ---------------- 1. Your business ---------------- */

function BusinessCard({
  tenant,
  businessName,
  setBusinessName,
  businessCategory,
  canEdit,
  onSaveActivity,
}: {
  tenant: TenantRow;
  /** Lifted to the page: How you answer reads the draft so Automatic follows a rename. */
  businessName: string;
  setBusinessName: (next: string) => void;
  businessCategory: string | null;
  canEdit: boolean;
  onSaveActivity?: () => void;
}) {
  const formId = "identity-business-form";
  const [storedVertical, setStoredVertical] = useState(() => parseVertical(tenant.vertical));
  const storedCategory = useRef(businessCategory);
  const [choice, setChoice] = useState(() => currentCategoryChoice(storedVertical, businessCategory));
  const options = useMemo(() => identityCategoryChoices(storedVertical), [storedVertical]);
  const writes = categoryWrites(choice || `${storedVertical}:`, {
    vertical: storedVertical,
    category: storedCategory.current,
  });

  // The pack (vertical) goes with the settings save, so Voice and Brain read it at once.
  // The typed category follows through its own action, checked against the saved pack.
  const save = useCardSave(
    formId,
    async (prev, data) => {
      const res = await saveAndCompileSettings(prev, data);
      if (!res.ok || res.error) return res;
      const pick = String(data.get("identity_category") || "");
      const next = categoryWrites(pick, { vertical: storedVertical, category: storedCategory.current });
      setStoredVertical(next.vertical);
      if (next.categoryChanged && next.category) {
        const cat = await saveBusinessCategoryAction(next.category);
        if (!cat.ok) return { ...res, error: cat.error };
        storedCategory.current = next.category;
      }
      return res;
    },
    onSaveActivity
  );
  const { dirty, justSaved } = useFormDraft(save, { id: formId, values: [businessName, choice] });
  const nameMissing = !businessName.trim();
  const [nameOpen, setNameOpen] = useState(false);

  return (
    <IdentityCard
      id={formId}
      scope="identity-business"
      tenantId={tenant.id}
      title="Your business"
      save={save}
      dirty={dirty}
      justSaved={justSaved}
      canEdit={canEdit}
      hidden={
        <>
          <input type="hidden" name="business_name" value={businessName} />
          <input type="hidden" name="vertical" value={writes.vertical} />
          <input type="hidden" name="identity_category" value={choice} />
        </>
      }
    >
      <button
        type="button"
        onClick={() => canEdit && setNameOpen(true)}
        className={`flex min-h-11 w-full items-center gap-3 px-4 py-2 text-start ${deskShiftClass} hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand`}
      >
        <span className="min-w-0 flex-1 md:flex md:items-center md:gap-3">
          <span className="block text-body font-medium text-ink md:shrink-0">Business name</span>
          <span className="mt-0.5 line-clamp-2 text-body text-ink-2 [overflow-wrap:anywhere] md:mt-0 md:min-w-0 md:flex-1 md:truncate md:text-end">
            {businessName.trim() || "Add"}
          </span>
        </span>
        <ChevronRightIcon className="size-5 shrink-0 text-ink-3" aria-hidden />
      </button>
      <Sheet open={nameOpen} onOpenChange={setNameOpen} title="Business name">
        <label htmlFor="identity_business_name" className="mb-1 block text-meta text-ink-2">Business name</label>
        <input
          id="identity_business_name"
          value={businessName}
          onChange={(e) => setBusinessName(e.target.value)}
          placeholder="Westlands Books"
          aria-invalid={dirty && nameMissing ? true : undefined}
          title={businessName}
          className={settingsDenseFieldClass}
        />
      </Sheet>
      <ChoiceSheet
        id="identity_category"
        title="What you do"
        rowLabel="What you do"
        value={choice}
        placeholder="Choose"
        options={options.map((opt) => ({ value: opt.value, label: opt.label, detail: opt.detail || undefined }))}
        onChange={(next) => {
          if (canEdit) setChoice(next);
        }}
      />
    </IdentityCard>
  );
}

/* ---------------- 2. How you answer ---------------- */

function initialVoiceId(tenant: TenantRow, voices: CuratedSonioxVoice[]): string {
  const raw = String(tenant.soniox_voice_id || "").trim();
  if (raw && voices.some((v) => v.id === raw)) return raw;
  const marked = voices.find((v) => v.default);
  return marked?.id || voices[0]?.id || getDefaultSonioxVoiceIdSync() || "";
}

const LANGUAGE_PICKS: readonly { value: GreetingLanguagePick; label: string; detail?: string }[] = [
  { value: "auto", label: "Automatic", detail: "Kiswahili when your greeting words are in Kiswahili, else English" },
  ...GREETING_LANGUAGES.map((l) => ({ value: l.id as GreetingLanguagePick, label: l.label })),
];

function languageLabel(pick: GreetingLanguagePick, resolved: GreetingLanguage): string {
  const name = GREETING_LANGUAGES.find((l) => l.id === resolved)?.label || "English";
  return pick === "auto" ? `Automatic · ${name}` : name;
}

function AnswerCard({
  tenant,
  businessName,
  voices,
  canEdit,
  onSaveActivity,
}: {
  tenant: TenantRow;
  /** The business name as typed in Your business, so Automatic follows a rename at once. */
  businessName: string;
  voices: CuratedSonioxVoice[];
  canEdit: boolean;
  onSaveActivity?: () => void;
}) {
  const formId = "identity-answer-form";
  const [agentName, setAgentName] = useState(tenant.agent_name || "");
  const [nameOpen, setNameOpen] = useState(false);
  const [greetingOpen, setGreetingOpen] = useState(false);
  const [confirmAuto, setConfirmAuto] = useState(false);
  // Warm is the default tone, so a first save never stops on a choice.
  const [tone, setTone] = useState<OnboardingTone | "">(
    () => canonicalizeAgentTone(String(tenant.agent_tone || "")) || "warm"
  );
  const [spokenName, setSpokenName] = useState(tenant.spoken_name || "");
  const [greetingInvite, setGreetingInvite] = useState(tenant.greeting_invite || "");
  const [storedVoiceId, setStoredVoiceId] = useState(() => initialVoiceId(tenant, voices));
  const [voiceId, setVoiceId] = useState(storedVoiceId);
  // tenants.greeting_language: the business's default greeting language.
  // Automatic (null) follows the owner's own words; saved with this card.
  const [languagePick, setLanguagePick] = useState<GreetingLanguagePick>(() =>
    greetingLanguagePickFromStored(tenant.greeting_language)
  );
  // tenants.greeting_text: the owner's full greeting, said word for word. Desk never types one;
  // Go back to automatic clears it with this card's save (greeting_text_clear). Not a compile input.
  const [storedOwnText, setStoredOwnText] = useState(() => (tenant.greeting_text || "").trim());
  const [ownText, setOwnText] = useState(storedOwnText);
  const greetingText = ownText;
  const clearOwnText = Boolean(storedOwnText) && !ownText;
  const mode = greetingMode({ greetingText: ownText, spokenName, greetingInvite });
  const automatic = mode === "automatic";
  const [editingGreeting, setEditingGreeting] = useState(false);
  // Change greeting opens on these values; Cancel and Escape put them back.
  const openedWith = useRef<{ spokenName: string; greetingInvite: string } | null>(null);
  const storedLabel = String(tenant.soniox_voice_label || "").trim();
  // A label names the old voice; a new voice drops it.
  const voiceLabel = voiceId === storedVoiceId ? storedLabel : "";
  const language = resolveGreetingLanguage(languagePick, greetingInvite, greetingText);

  const sentence = buildGreetingSentence({
    businessName,
    spokenName,
    agentName,
    greetingInvite,
    greetingText,
    language,
  });
  const played = playedGreetingFromTenant({
    business_name: businessName,
    spoken_name: spokenName,
    agent_name: agentName,
    greeting_invite: greetingInvite,
    greeting_text: greetingText,
    greeting_language: greetingLanguageForStorage(languagePick),
  });

  const save = useCardSave(
    formId,
    async (prev, data) => {
      const res = await saveAndCompileSettings(prev, data);
      if (res.ok && !res.error) {
        setStoredVoiceId(String(data.get("soniox_voice_id") || ""));
        if (String(data.get("greeting_text_clear") || "") === "1") setStoredOwnText("");
      }
      return res;
    },
    onSaveActivity
  );
  const { dirty, justSaved } = useFormDraft(save, {
    id: formId,
    values: [agentName, tone, spokenName, greetingInvite, voiceId, languagePick, ownText],
  });

  const [sampleUrl, setSampleUrl] = useState<string | null>(null);
  const [sampleError, setSampleError] = useState<string | null>(null);
  const [sampleLoading, setSampleLoading] = useState(false);
  useEffect(() => {
    return () => {
      if (sampleUrl) URL.revokeObjectURL(sampleUrl);
    };
  }, [sampleUrl]);

  async function hearIt() {
    setSampleLoading(true);
    setSampleError(null);
    if (sampleUrl) {
      URL.revokeObjectURL(sampleUrl);
      setSampleUrl(null);
    }
    try {
      // Same preview the Voice panel used: the voice line reads this exact draft.
      const res = await fetch("/api/pronunciation/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: [sentence.text || greetingInviteLine("", language), sentence.notice].filter(Boolean).join(" "),
          language,
          lexicon: lexiconForStorage(parseTtsLexicon(tenant.tts_lexicon)),
          voiceId: resolveLiveCallVoiceId(voiceId, voices),
        }),
      });
      const preview = await objectUrlFromPreviewResponse(res);
      try {
        await assertPreviewAudioPlayable(preview.url);
      } catch (err) {
        URL.revokeObjectURL(preview.url);
        throw err;
      }
      setSampleUrl(preview.url);
    } catch (err) {
      setSampleError(previewErrorCopy(err));
    } finally {
      setSampleLoading(false);
    }
  }

  // Go back to automatic, then Keep my greeting: everything returns as it was.
  const beforeAutomatic = useRef<{ spokenName: string; greetingInvite: string } | null>(null);
  function switchToAutomatic() {
    if (mode === "own") beforeAutomatic.current = { spokenName, greetingInvite };
    setSpokenName("");
    setGreetingInvite("");
    setOwnText("");
    setEditingGreeting(false);
    openedWith.current = null;
  }

  function keepOwnGreeting() {
    const was = beforeAutomatic.current;
    if (was) {
      setSpokenName(was.spokenName);
      setGreetingInvite(was.greetingInvite);
    }
    beforeAutomatic.current = null;
    setOwnText(storedOwnText);
  }

  function openGreetingEdit() {
    openedWith.current = { spokenName, greetingInvite };
    setEditingGreeting(true);
  }

  /** Cancel and Escape: the name and question go back to how they were when Change greeting opened. */
  function cancelGreetingEdit() {
    const was = openedWith.current;
    if (was) {
      setSpokenName(was.spokenName);
      setGreetingInvite(was.greetingInvite);
    }
    openedWith.current = null;
    setEditingGreeting(false);
  }

  function onGreetingKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Escape" || !editingGreeting) return;
    event.preventDefault();
    event.stopPropagation();
    cancelGreetingEdit();
  }

  const voiceOptions = voices.map((voice) => ({
    id: voice.id,
    label: displaySonioxVoiceLabel("", voice.id, voices),
  }));

  return (
    <IdentityCard
      id={formId}
      scope="identity-answer"
      tenantId={tenant.id}
      title="How you answer"
      save={save}
      dirty={dirty}
      justSaved={justSaved}
      canEdit={canEdit}
      hidden={
        <>
          <input type="hidden" name="agent_name" value={agentName} />
          <input type="hidden" name="agent_tone" value={tone} />
          <input type="hidden" name="spoken_name" value={spokenName} />
          <input type="hidden" name="greeting_invite" value={greetingInvite} />
          <input type="hidden" name="soniox_voice_id" value={voiceId} />
          <input type="hidden" name="soniox_voice_label" value={voiceLabel} />
          <input
            type="hidden"
            name="greeting_language"
            value={greetingLanguageForStorage(languagePick) ?? "auto"}
          />
          {clearOwnText ? <input type="hidden" name="greeting_text_clear" value="1" /> : null}
        </>
      }
    >
      <div className="space-y-3 px-4 py-3" data-greeting="" data-greeting-mode={mode} onKeyDown={onGreetingKeyDown}>
        <div className="flex min-h-6 items-center gap-2">
          <p className="text-meta font-medium text-ink-2" id="identity-greeting-label">
            Callers hear
          </p>
          {automatic ? (
            <span
              data-greeting-automatic=""
              className="rounded-md bg-accent-soft px-1.5 py-0.5 text-meta font-medium text-accent-deep"
            >
              Automatic
            </span>
          ) : mode === "own" ? (
            <span
              data-greeting-own=""
              className="rounded-md bg-surface-2 px-1.5 py-0.5 text-meta font-medium text-ink"
            >
              Your own greeting
            </span>
          ) : null}
        </div>
        <div
          aria-labelledby="identity-greeting-label"
          className="space-y-1 rounded-xl bg-surface-2 px-3 py-2.5 [overflow-wrap:anywhere]"
        >
          <p data-greeting-sentence="" className="text-body text-ink">
            {played ? (
              played
            ) : (
              <span className="text-ink-2">Add your business name and callers hear it here.</span>
            )}
          </p>
          {sentence.text && sentence.notice ? (
            <p data-greeting-notice="" className="text-meta text-ink-2">
              {sentence.notice}
            </p>
          ) : null}
        </div>
        {mode === "own" ? (
          <p className="text-meta text-ink-2" data-greeting-own-help="">
            Callers hear these words exactly. Go back to automatic to build it from your business name.
          </p>
        ) : clearOwnText ? (
          <div className="flex flex-wrap items-center gap-x-3" data-greeting-clear-pending="">
            <p className="min-w-0 flex-1 text-meta text-ink-2">Save to switch. Until then callers hear your own greeting.</p>
            <button type="button" onClick={keepOwnGreeting} data-keep-own="" className={settingsGhostButtonClass}>
              Keep my greeting
            </button>
          </div>
        ) : sentence.text && sentence.notice ? (
          <p className="text-meta text-ink-2" data-greeting-notice-help="">
            Calls also get a short recording notice.
          </p>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          <span data-role-exempt="">
            <Button
              variant="tonal"
              size="md"
              pending={sampleLoading}
              leading={<SpeakerWaveIcon aria-hidden="true" className="size-4" />}
              onClick={() => void hearIt()}
            >
              Hear it
            </Button>
          </span>
          {canEdit && mode !== "own" ? (
            <button
              type="button"
              aria-expanded={greetingOpen}
              aria-controls="identity-greeting-fields"
              onClick={() => {
                setGreetingOpen(true);
                if (!editingGreeting) openGreetingEdit();
              }}
              className={`inline-flex min-h-11 items-center gap-1 ${settingsGhostButtonClass}`}
            >
              {editingGreeting ? "Done" : "Change greeting"}
              <ChevronRightIcon className="size-5 shrink-0 text-ink-3" aria-hidden />
            </button>
          ) : canEdit ? (
            <button
              type="button"
              onClick={() => setGreetingOpen(true)}
              className={`inline-flex min-h-11 items-center gap-1 ${settingsGhostButtonClass}`}
            >
              Change greeting
              <ChevronRightIcon className="size-5 shrink-0 text-ink-3" aria-hidden />
            </button>
          ) : null}
        </div>
        {sampleUrl ? (
          <audio
            controls
            autoPlay
            preload="metadata"
            className="max-w-full"
            onError={() => {
              URL.revokeObjectURL(sampleUrl);
              setSampleUrl(null);
              setSampleError(NO_VOICE_SAMPLE_COPY);
            }}
          >
            <source src={sampleUrl} type="audio/wav" />
          </audio>
        ) : sampleError ? (
          <p className="text-meta text-warn" role="alert" data-testid="voice-sample-empty">
            {sampleError}
          </p>
        ) : null}
      </div>
      <Sheet open={greetingOpen} onOpenChange={setGreetingOpen} title="Greeting">
      {editingGreeting && canEdit && mode !== "own" ? (
        <div id="identity-greeting-fields" data-greeting-fields="" onKeyDown={onGreetingKeyDown}>
          <SettingsRow label="Name callers hear" htmlFor="spoken_name">
            <input
              id="spoken_name"
              value={spokenName}
              onChange={(e) => setSpokenName(e.target.value)}
              placeholder={businessName.trim() || "Your business name"}
              maxLength={SPOKEN_NAME_MAX}
              autoFocus
              className={settingsValueFieldClass}
            />
          </SettingsRow>
          <SettingsRow label="Then asks" htmlFor="greeting_invite">
            <input
              id="greeting_invite"
              value={greetingInvite}
              onChange={(e) => setGreetingInvite(e.target.value)}
              placeholder={greetingInviteLine("", language)}
              maxLength={GREETING_INVITE_MAX}
              className={settingsValueFieldClass}
            />
          </SettingsRow>
          {canEdit && editingGreeting ? (
            <button type="button" onClick={cancelGreetingEdit} data-greeting-cancel="" className={settingsGhostButtonClass}>
              Cancel
            </button>
          ) : null}
        </div>
      ) : (
        <p className="px-1 text-body text-ink-2">Callers hear your own greeting.</p>
      )}
      {canEdit && mode === "own" ? (
        <button type="button" onClick={() => setConfirmAuto(true)} data-go-automatic="" className={settingsGhostButtonClass}>
          Go back to automatic
        </button>
      ) : canEdit && !automatic && !editingGreeting ? (
        <button type="button" onClick={() => setConfirmAuto(true)} data-use-automatic="" className={settingsGhostButtonClass}>
          Use automatic
        </button>
      ) : null}
      </Sheet>
      <ConfirmSheet
        open={confirmAuto}
        title="Use the automatic greeting?"
        confirmLabel="Use automatic"
        onClose={() => setConfirmAuto(false)}
        onConfirm={() => {
          setConfirmAuto(false);
          switchToAutomatic();
        }}
      >
        Your own words will be removed.
      </ConfirmSheet>
      <button
        type="button"
        onClick={() => canEdit && setNameOpen(true)}
        className={`flex min-h-11 w-full items-center gap-3 px-4 text-start ${deskShiftClass} hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand`}
      >
        <span className="shrink-0 text-body font-medium text-ink">Assistant name</span>
        <span className="min-w-0 flex-1 truncate text-end text-body text-ink-2">{agentName.trim() || "Add"}</span>
        <ChevronRightIcon className="size-5 shrink-0 text-ink-3" aria-hidden />
      </button>
      <Sheet open={nameOpen} onOpenChange={setNameOpen} title="Assistant name">
        <label htmlFor="agent_name" className="mb-1 block text-meta text-ink-2">Assistant name</label>
        <input
          id="agent_name"
          value={agentName}
          onChange={(e) => setAgentName(e.target.value)}
          placeholder="Aisha"
          maxLength={40}
          className={settingsDenseFieldClass}
        />
      </Sheet>
      <SettingsSelect
        id="agent_tone"
        label="Tone"
        value={tone}
        placeholder="Warm"
        onChange={(next) => {
          if (canEdit) setTone(next);
        }}
        options={TONE_OPTIONS.map((opt) => ({ id: opt.id, label: TONE_LABELS[opt.id], detail: opt.blurb }))}
      />
      {voiceOptions.length ? (
        <SettingsSelect
          id="soniox_voice_id"
          label="Voice"
          value={voiceId}
          onChange={(next) => {
            if (canEdit) setVoiceId(next);
          }}
          options={voiceOptions}
        />
      ) : (
        <SettingsRow label="Voice">
          <p className="text-end text-body text-ink-2">No voices loaded</p>
        </SettingsRow>
      )}
      <div data-greeting-language={languagePick}>
        <ChoiceSheet
          id="identity_language"
          title="Greeting language"
          rowLabel="Greeting language"
          value={languagePick}
          options={LANGUAGE_PICKS.map((opt) => ({
            ...opt,
            label:
              opt.value === "auto"
                ? languageLabel("auto", autoGreetingLanguage(greetingInvite, greetingText))
                : opt.label,
          }))}
          onChange={(next) => {
            if (canEdit) setLanguagePick(next);
          }}
        />
        <p className="px-4 pb-2 text-meta text-ink-2" data-language-note="">
          Returning callers hear the language they used last.
        </p>
      </div>
    </IdentityCard>
  );
}

/* ---------------- 3. How customers reach you ---------------- */

function ContactsCard({
  tenant,
  canEdit,
  onSaveActivity,
}: {
  tenant: TenantRow;
  canEdit: boolean;
  onSaveActivity?: () => void;
}) {
  const formId = "identity-contacts-form";
  const [channels, setChannels] = useState<SocialChannel[]>(
    () => normalizeSocialHandles(tenant.social_handles).channels
  );
  const [editing, setEditing] = useState<number | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState<number | null>(null);
  const filled = channels.filter((c) => c.value.trim());
  const json = JSON.stringify({ channels: filled });
  const save = useCardSave(formId, saveAndCompileSettings, onSaveActivity);
  const { dirty, justSaved } = useFormDraft(save, { id: formId, values: [json] });

  const full = channels.length >= SOCIAL_CHANNELS_MAX;
  function add(kind: ContactAddKind) {
    if (full) return;
    setChannels((prev) => [...prev, newContact(kind)]);
    setEditing(channels.length);
  }
  function update(index: number, patch: Partial<SocialChannel>) {
    setChannels((prev) => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }
  function remove(index: number) {
    setChannels((prev) => prev.filter((_, i) => i !== index));
    setEditing(null);
  }

  const addButtons = canEdit ? (
    <>
      <button
        type="button"
        data-contact-add=""
        disabled={full}
        onClick={() => setAddOpen(true)}
        className={`flex min-h-11 w-full items-center gap-3 px-4 text-start text-body font-medium text-ink ${deskShiftClass} hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand disabled:opacity-50`}
      >
        <PlusIcon aria-hidden="true" className="size-5 shrink-0 text-accent" />
        <span className="min-w-0 flex-1">Add a way to reach you</span>
        <ChevronRightIcon className="size-5 shrink-0 text-ink-3" aria-hidden />
      </button>
      <Sheet open={addOpen} onOpenChange={setAddOpen} title="Add a way to reach you">
        {(
          [
            ["phone", "Phone"],
            ["whatsapp", "WhatsApp"],
            ["social", "Social"],
          ] as const
        ).map(([kind, label]) => (
          <button
            key={kind}
            type="button"
            className={`flex min-h-11 w-full items-center rounded-xl px-3 text-start text-body text-ink ${deskShiftClass} hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand`}
            onClick={() => {
              add(kind);
              setAddOpen(false);
            }}
          >
            {label}
          </button>
        ))}
      </Sheet>
    </>
  ) : null;

  return (
    <IdentityCard
      id={formId}
      scope="identity-contacts"
      tenantId={tenant.id}
      title="How customers reach you"
      save={save}
      dirty={dirty}
      justSaved={justSaved}
      canEdit={canEdit}
      hidden={<input type="hidden" name="social_handles" value={json} />}
      footer={addButtons}
    >
      {channels.length === 0 ? (
        <p className="px-4 py-3 text-body text-ink-2" data-contacts-empty="">
          No contacts yet
        </p>
      ) : (
        <ul className="divide-y divide-hairline">
          {channels.map((channel, index) => (
              <li key={index} data-contact-row="">
                <button
                  type="button"
                  onClick={() => canEdit && setEditing(index)}
                  className={`flex min-h-12 w-full items-center gap-3 px-4 py-1.5 text-start ${deskShiftClass} hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand`}
                >
                  <p className="min-w-0 flex-1 text-body [overflow-wrap:anywhere]">
                    <span className="font-medium text-ink">{contactRowTitle(channel)}</span>{" "}
                    <span className="text-ink-2">
                      {channel.value.trim() ? formatContactValue(channel.kind, channel.value) : "Not filled in"}
                    </span>
                  </p>
                  <ChevronRightIcon className="size-5 shrink-0 text-ink-3" aria-hidden />
                </button>
                <Sheet open={editing === index} onOpenChange={(next) => { if (!next) setEditing(null); }} title={contactRowTitle(channel)}>
                  <div className="space-y-2" data-contact-editing="">
                    {channel.kind === "phone" || channel.kind === "whatsapp" ? (
                      <p className="flex min-h-11 items-center text-body font-medium text-ink">{contactKindLabel(channel.kind)}</p>
                    ) : (
                      <DeskSelect
                        id={`contact-kind-${index}`}
                        aria-label="Where"
                        value={channel.kind}
                        className={settingsDenseFieldClass}
                        options={SOCIAL_KINDS.map((k) => ({ value: k.id, label: k.label }))}
                        onChange={(next) => update(index, { kind: next })}
                      />
                    )}
                    <label className="sr-only" htmlFor={`contact-value-${index}`}>{contactKindLabel(channel.kind)}</label>
                    <input
                      id={`contact-value-${index}`}
                      value={channel.value}
                      onChange={(e) => update(index, { value: e.target.value })}
                      placeholder={contactPlaceholder(channel.kind)}
                      inputMode={channel.kind === "phone" || channel.kind === "whatsapp" ? "tel" : undefined}
                      className={settingsDenseFieldClass}
                    />
                    <label className="flex min-h-11 items-center text-body text-ink-2" htmlFor={`contact-label-${index}`}>Label (optional)</label>
                    <input
                      id={`contact-label-${index}`}
                      value={channel.label}
                      onChange={(e) => update(index, { label: e.target.value })}
                      placeholder="Sales"
                      maxLength={40}
                      className={settingsDenseFieldClass}
                    />
                    <div className="flex justify-end gap-2">
                      <button type="button" onClick={() => setConfirmRemove(index)} className={settingsGhostButtonClass}>Remove</button>
                      <Button variant="tonal" onClick={() => setEditing(null)}>Done</Button>
                    </div>
                  </div>
                </Sheet>
              </li>
          ))}
        </ul>
      )}
      <ConfirmSheet
        open={confirmRemove != null}
        title="Remove this contact?"
        confirmLabel="Remove"
        danger
        onClose={() => setConfirmRemove(null)}
        onConfirm={() => {
          if (confirmRemove != null) remove(confirmRemove);
          setConfirmRemove(null);
        }}
      >
        It leaves the list when you save.
      </ConfirmSheet>
    </IdentityCard>
  );
}

/* ---------------- Page ---------------- */

function IdentitySettingsInner({
  tenant,
  curatedVoices,
  heading,
  sidebar,
  businessCategory,
  onSaveActivity,
}: {
  tenant: TenantRow;
  curatedVoices?: CuratedSonioxVoice[];
  heading?: string | null;
  sidebar?: ReactNode;
  /** tenants.business_category (null before the typed-data migration). */
  businessCategory?: string | null;
  onSaveActivity?: () => void;
}) {
  const canEdit = useCan("settings.edit");
  const [businessName, setBusinessName] = useState(tenant.business_name || "");
  const voices = curatedVoices && curatedVoices.length ? curatedVoices : listCuratedSonioxVoicesSync();
  return (
    <div className={settingsConsoleClass}>
      {sidebar}
      <div className={`${settingsPanelClass} space-y-4`}>
        <SettingsPageHeader
          businessName={tenant.business_name?.trim() || "Business"}
          lineLive={false}
          showBack
          wide
          title={heading ?? "Identity"}
        />
        {/* Wide desktop: two columns up to the MASTER desk width, so no empty right side.
            Rows are auto then 1fr: How you answer spans both, and its extra height lands in
            row 2, so Your business never stretches and leaves a dead gap above the contacts.
            DOM order stays business, answer, contacts (phone reading and focus order). */}
        <div
          className="grid w-full min-w-0 max-w-desk grid-cols-1 items-start gap-6 xl:grid-cols-2 xl:grid-rows-[auto_1fr]"
          data-identity-page=""
        >
          <div className="min-w-0 xl:col-start-1 xl:row-start-1">
            <BusinessCard
              tenant={tenant}
              businessName={businessName}
              setBusinessName={setBusinessName}
              businessCategory={businessCategory ?? null}
              canEdit={canEdit}
              onSaveActivity={onSaveActivity}
            />
          </div>
          <div className="min-w-0 xl:col-start-2 xl:row-span-2 xl:row-start-1">
            <AnswerCard
              tenant={tenant}
              businessName={businessName}
              voices={voices}
              canEdit={canEdit}
              onSaveActivity={onSaveActivity}
            />
          </div>
          <div className="min-w-0 xl:col-start-1 xl:row-start-2">
            <ContactsCard tenant={tenant} canEdit={canEdit} onSaveActivity={onSaveActivity} />
          </div>
        </div>
      </div>
    </div>
  );
}

/** Settings › Identity: three cards, each saving on its own. Viewers read it locked. */
export const IdentitySettings = withRoleGate("settings.edit", IdentitySettingsInner);
