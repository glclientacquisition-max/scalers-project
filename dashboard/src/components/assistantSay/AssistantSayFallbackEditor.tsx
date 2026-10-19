"use client";

import { useMemo, useState, useTransition } from "react";
import { saveUnknownAnswerByKindAction } from "@/app/(desk)/settings/assistantSayActions";
import { Button } from "@/components/ui/Button";
import { SettingsGroup, SettingsStack, settingsFieldClass } from "@/components/settingsUi";
import {
  spokenFallbackLine,
  FALLBACK_KIND_LABELS,
  FALLBACK_KINDS,
  type UnknownAnswerByKind,
} from "@/lib/unknownAnswerByKindConstants";

const fieldClass = `${settingsFieldClass} min-h-11`;

type Props = {
  initial: UnknownAnswerByKind | null;
  legacyGeneral?: string | null;
};

export function AssistantSayFallbackEditor({ initial, legacyGeneral }: Props) {
  const [byKind, setByKind] = useState<UnknownAnswerByKind | null>(initial);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

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

  function onSave(formData: FormData) {
    startTransition(async () => {
      setMessage(null);
      const res = await saveUnknownAnswerByKindAction(formData);
      if (!res.ok) {
        setMessage(res.error || "Could not save.");
        return;
      }
      setByKind(res.byKind);
      setMessage("Saved.");
    });
  }

  return (
    <SettingsGroup title="When unsure">
      <p className="px-4 pb-2 text-meta text-ink-3">
        Fallback lines only offer a callback. They never promise a transfer, a booking slot, or open today.
      </p>
      <form
        className="divide-y divide-hairline"
        onSubmit={(event) => {
          event.preventDefault();
          onSave(new FormData(event.currentTarget));
        }}
      >
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
          </div>
        ))}
        <div className="flex items-center justify-between gap-3 px-4 py-3">
          <p className="text-meta text-ink-3" aria-live="polite">{message}</p>
          <Button type="submit" variant="tonal" size="sm" disabled={pending}>
            {pending ? "Saving" : "Save"}
          </Button>
        </div>
      </form>
    </SettingsGroup>
  );
}
