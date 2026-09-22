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
  settingsPrimaryButtonClass,
} from "@/components/settingsUi";
import { deskShiftClass } from "@/components/ui/deskChrome";

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
    <div className="grid min-w-0 grid-cols-1 gap-6 lg:grid-cols-2 lg:gap-8">
      <section className="space-y-4" aria-labelledby="test-preview-heading">
        <h3
          id="test-preview-heading"
          className="text-sm font-medium text-ink"
        >
          Phone preview
        </h3>

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
              className={`${settingsPrimaryButtonClass} w-full sm:w-auto sm:min-w-[12rem]`}
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
      </section>

      <section className="space-y-3 lg:border-l lg:border-line lg:pl-8" aria-labelledby="test-call-heading">
        <h3
          id="test-call-heading"
          className="text-sm font-medium text-ink"
        >
          Live call
        </h3>
        {pendingDid || !did ? (
          <p className="text-sm text-ink-soft">
            Number pending. Finish setup before calling.
          </p>
        ) : (
          <a
            href={`tel:${did}`}
            className={`flex min-h-14 w-full items-center justify-center rounded-2xl border border-line bg-surface px-4 py-4 text-center font-display text-xl font-semibold tracking-tight text-ink ${deskShiftClass} hover:border-accent focus:outline-none focus:ring-2 focus:ring-accent`}
          >
            {did}
          </a>
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
      </section>
    </div>
  );
}
