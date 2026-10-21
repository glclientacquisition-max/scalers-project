"use client";

import { useMemo, useState } from "react";
import { saveUnknownAnswerByKindAction } from "@/app/(desk)/settings/assistantSayActions";
import { Button } from "@/components/ui/Button";
import { useFormDraft, useFormSave } from "@/components/useFormSave";
import { SettingsGroup, SettingsStack, settingsFieldClass } from "@/components/settingsUi";
import {
  spokenFallbackLine,
  FALLBACK_KIND_LABELS,
  FALLBACK_KINDS,
  type UnknownAnswerByKind,
} from "@/lib/unknownAnswerByKindConstants";

const fieldClass = `${settingsFieldClass} min-h-11`;

type FallbackSaveState = {
  ok?: boolean;
  error?: string | null;
  byKind?: UnknownAnswerByKind | null;
};

const initialSave: FallbackSaveState = {};

async function saveFallbacks(_prev: FallbackSaveState, formData: FormData): Promise<FallbackSaveState> {
  return saveUnknownAnswerByKindAction(formData);
}

const FALLBACK_FORM_ID = "assistant-say-fallback-form";

type Props = {
  initial: UnknownAnswerByKind | null;
  legacyGeneral?: string | null;
};

export function AssistantSayFallbackEditor({ initial, legacyGeneral }: Props) {
  const [byKind, setByKind] = useState<UnknownAnswerByKind | null>(initial);
  // Shared save pattern: toast, inline Saved, errors with retry, dirty and guard.
  const save = useFormSave<FallbackSaveState>({
    action: saveFallbacks,
    initialState: initialSave,
    successMessage: "Saved",
    formId: FALLBACK_FORM_ID,
  });
  const { pending } = save;
  // Adopt the stored lines in render, so the baseline below is the saved draft.
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
        en: enCustom || spokenFallbackLine(kind, byKind, "en", legacyGeneral),
        sw: swCustom || spokenFallbackLine(kind, byKind, "sw", legacyGeneral),
      };
    }
    return out;
  }, [byKind, legacyGeneral]);

  const { justSaved } = useFormDraft(save, { id: "assistant-say-fallback", values, adoptsResult: true });

  return (
    <SettingsGroup title="When unsure">
      <p className="px-4 pb-2 text-meta text-ink-3">
        Fallback lines only offer a callback. They never promise a transfer, a booking slot, or open today.
      </p>
      <form id={FALLBACK_FORM_ID} className="divide-y divide-hairline" action={save.formAction}>
        {FALLBACK_KINDS.map((kind) => (
          <div key={kind} className="px-4 py-3">
            <p className="text-body font-medium text-ink">{FALLBACK_KIND_LABELS[kind]}</p>
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
            <p className="mt-1 text-meta text-ink-3">
              Callers hear: {spokenFallbackLine(kind, byKind, "en", legacyGeneral)}
            </p>
            <p className="mt-1 text-meta text-ink-3" lang="sw">
              Wanasikia: {spokenFallbackLine(kind, byKind, "sw", legacyGeneral)}
            </p>
          </div>
        ))}
        <div className="flex items-center justify-between gap-3 px-4 py-3">
          {save.error ? (
            <p className="min-w-0 flex-1 text-meta text-warn" role="alert">
              {save.error}{" "}
              <button type="button" onClick={save.retry} className="font-medium text-accent underline-offset-2 hover:underline">
                Try again
              </button>
            </p>
          ) : (
            <span aria-hidden="true" />
          )}
          <Button type="submit" variant="tonal" size="sm" disabled={pending}>
            {pending ? "Saving" : justSaved ? "Saved" : "Save"}
          </Button>
        </div>
      </form>
    </SettingsGroup>
  );
}
