"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { businessSettingsHref } from "@/lib/businessSettingsNav";
import {
  lexiconForStorage,
  parseTtsLexicon,
} from "@/lib/pronunciationLexicon";
import {
  previewBusinessAssistantIntro,
} from "@/lib/businessAssistantIntro";
import { previewSpokenLine } from "@/lib/pronunciationPacks";
import {
  displaySonioxVoiceLabel,
  resolveLiveCallVoiceId,
  type CuratedSonioxVoice,
} from "@/lib/sonioxVoiceCatalog";
import type { TenantRow } from "@/lib/supabase";
import {
  assertPreviewAudioPlayable,
  NO_VOICE_SAMPLE_COPY,
  objectUrlFromPreviewResponse,
  previewErrorCopy,
} from "@/lib/previewAudio";
import {
  SettingsGroup,
  settingsGhostButtonClass,
  settingsPrimaryButtonClass,
} from "@/components/settingsUi";

/**
 * Business Settings → Test
 * One job: prove the line sounds right before / instead of placing a live call.
 */
export function TestLinePanel({
  tenant,
  curatedVoices = [],
}: {
  tenant: TenantRow;
  curatedVoices?: CuratedSonioxVoice[];
}) {
  const pendingDid = String(tenant.sautikit_virtual_number || "").startsWith(
    "pending:"
  );
  const did = String(tenant.sautikit_virtual_number || "").trim();
  const lineLive = Boolean(did) && !pendingDid;
  const businessName = String(tenant.business_name || "").trim();
  const agentName = String(tenant.agent_name || "").trim() || "Assistant";
  const sonioxVoiceId = resolveLiveCallVoiceId(
    tenant.soniox_voice_id,
    curatedVoices
  );
  const sonioxVoiceLabel = String(tenant.soniox_voice_label || "").trim();
  const lexicon = useMemo(
    () => parseTtsLexicon(tenant.tts_lexicon),
    [tenant.tts_lexicon]
  );

  const greetingPreview = useMemo(() => {
    if (!businessName) return "";
    const sample = previewBusinessAssistantIntro({
      businessName,
      agentName,
      servicesCatalog: Array.isArray(tenant.services_catalog)
        ? tenant.services_catalog
        : [],
      servicesOffered: tenant.services_offered,
    });
    return previewSpokenLine(sample, lexicon);
  }, [
    businessName,
    agentName,
    lexicon,
    tenant.services_catalog,
    tenant.services_offered,
  ]);

  const voiceLabel = displaySonioxVoiceLabel(
    sonioxVoiceLabel,
    sonioxVoiceId || null,
    curatedVoices
  );

  const [phonePreviewLoading, setPhonePreviewLoading] = useState(false);
  const [phonePreviewError, setPhonePreviewError] = useState<string | null>(
    null
  );
  const [phonePreviewUrl, setPhonePreviewUrl] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      if (phonePreviewUrl) URL.revokeObjectURL(phonePreviewUrl);
    };
  }, [phonePreviewUrl]);

  async function generatePhonePreview() {
    if (!greetingPreview) return;
    setPhonePreviewLoading(true);
    setPhonePreviewError(null);
    if (phonePreviewUrl) {
      URL.revokeObjectURL(phonePreviewUrl);
      setPhonePreviewUrl(null);
    }
    try {
      const res = await fetch("/api/pronunciation/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: greetingPreview,
          lexicon: lexiconForStorage(lexicon),
          voiceId: sonioxVoiceId,
        }),
      });
      const preview = await objectUrlFromPreviewResponse(res);
      try {
        await assertPreviewAudioPlayable(preview.url);
      } catch (probeErr) {
        URL.revokeObjectURL(preview.url);
        throw probeErr;
      }
      setPhonePreviewUrl(preview.url);
    } catch (err) {
      setPhonePreviewError(previewErrorCopy(err));
    } finally {
      setPhonePreviewLoading(false);
    }
  }

  return (
    <div className="min-w-0 w-full space-y-6">
      <SettingsGroup title="Preview">
        <div className="space-y-3 px-4 py-3">
          {greetingPreview ? (
            <>
              <blockquote className="border-l-2 border-accent/50 pl-4 text-base leading-relaxed text-ink">
                “{greetingPreview}”
              </blockquote>
              {voiceLabel ? (
                <p className="text-xs text-ink-soft">
                  Voice · <span className="text-ink">{voiceLabel}</span>
                  {lexicon.length
                    ? ` · ${lexicon.length} pronunciation override${lexicon.length === 1 ? "" : "s"}`
                    : null}
                </p>
              ) : null}
              <button
                type="button"
                onClick={() => generatePhonePreview()}
                disabled={phonePreviewLoading}
                className={
                  lineLive
                    ? settingsGhostButtonClass
                    : `${settingsPrimaryButtonClass} w-full sm:w-auto sm:min-w-[12rem]`
                }
              >
                {phonePreviewLoading ? "Generating…" : "Generate preview"}
              </button>
              {phonePreviewUrl ? (
                <audio
                  controls
                  preload="metadata"
                  className="w-full max-w-md"
                  onError={() => {
                    URL.revokeObjectURL(phonePreviewUrl);
                    setPhonePreviewUrl(null);
                    setPhonePreviewError(NO_VOICE_SAMPLE_COPY);
                  }}
                >
                  <source src={phonePreviewUrl} type="audio/wav" />
                </audio>
              ) : phonePreviewError ? (
                <p className="text-sm text-warn" role="alert">
                  {phonePreviewError}
                </p>
              ) : null}
            </>
          ) : (
            <p className="text-sm text-ink-soft">
              Add a business name and assistant name in{" "}
              <Link
                href={businessSettingsHref("train", "identity")}
                className="font-medium text-accent-deep underline-offset-2 hover:underline"
              >
                Identity
              </Link>{" "}
              to preview the greeting.
            </p>
          )}
        </div>
      </SettingsGroup>

      <SettingsGroup title="Line">
        <div className="space-y-3 px-4 py-3">
          {lineLive ? (
            <a
              href={`tel:${did}`}
              className={`${settingsPrimaryButtonClass} w-full sm:w-auto sm:min-w-[12rem]`}
            >
              Call {did}
            </a>
          ) : (
            <p className="text-sm text-ink-soft">
              Number pending. Finish setup before calling.
            </p>
          )}
          <p className="text-xs text-ink-soft">
            Fix names in{" "}
            <Link
              href={businessSettingsHref("train", "pronunciation")}
              className="font-medium text-accent-deep underline-offset-2 hover:underline"
            >
              Pronunciation
            </Link>
            {" · "}
            change voice in{" "}
            <Link
              href={businessSettingsHref("train", "tools")}
              className="font-medium text-accent-deep underline-offset-2 hover:underline"
            >
              Voice
            </Link>
            .
          </p>
        </div>
      </SettingsGroup>
    </div>
  );
}
