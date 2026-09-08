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
  type CuratedSonioxVoice,
} from "@/lib/sonioxVoiceCatalog";
import type { TenantRow } from "@/lib/supabase";
import {
  settingsPanelHeadingClass,
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
  const businessName = String(tenant.business_name || "").trim();
  const agentName = String(tenant.agent_name || "").trim() || "Receptionist";
  const sonioxVoiceId = String(tenant.soniox_voice_id || "").trim();
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

  async function playPhonePreview() {
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
          voiceId: sonioxVoiceId || undefined,
        }),
      });
      if (!res.ok) {
        const errJson = await res.json().catch(() => null);
        throw new Error(
          errJson && typeof errJson.error === "string"
            ? errJson.error
            : `Preview failed (${res.status})`
        );
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      setPhonePreviewUrl(url);
      await new Audio(url).play();
    } catch (err) {
      setPhonePreviewError(
        err instanceof Error ? err.message : "Could not play phone preview."
      );
    } finally {
      setPhonePreviewLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <header>
        <h2 className={settingsPanelHeadingClass}>Test</h2>
      </header>

      <section className="space-y-4" aria-labelledby="test-preview-heading">
        <h3
          id="test-preview-heading"
          className="text-sm font-medium text-ink"
        >
          Phone preview
        </h3>

        {greetingPreview ? (
          <>
            <blockquote className="border-l-2 border-[#0096FF]/50 pl-4 text-base leading-relaxed text-ink">
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
              onClick={() => playPhonePreview()}
              disabled={phonePreviewLoading}
              className={`${settingsPrimaryButtonClass} min-h-12 w-full text-base font-semibold sm:w-auto sm:min-w-[12rem]`}
            >
              {phonePreviewLoading ? "Generating…" : "Play phone preview"}
            </button>

            {phonePreviewUrl ? (
              <audio
                src={phonePreviewUrl}
                controls
                className="w-full max-w-md"
              />
            ) : null}

            {phonePreviewError ? (
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
              className="font-medium text-[#0096FF] underline-offset-2 transition-colors duration-150 hover:text-[#005ccc] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0096FF]/40"
            >
              Assistant
            </Link>{" "}
            to preview the greeting.
          </p>
        )}
      </section>

      <section className="space-y-3 border-t border-line pt-8" aria-labelledby="test-call-heading">
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
            className="flex min-h-14 w-full items-center justify-center rounded-2xl border border-line bg-white px-4 py-4 text-center font-display text-[clamp(1.15rem,4vw,1.5rem)] tracking-tight text-ink transition duration-150 hover:border-[#0096FF] hover:bg-[#0096FF]/[0.04] active:scale-[0.99] active:bg-[#0096FF]/[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0096FF]/40"
          >
            {did}
          </a>
        )}
        <p className="text-xs text-ink-soft">
          Fix names in{" "}
          <Link
            href={businessSettingsHref("train", "pronunciation")}
            className="font-medium text-[#0096FF] underline-offset-2 transition-colors duration-150 hover:text-[#005ccc] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0096FF]/40"
          >
            Pronunciation
          </Link>
          {" · "}
          change voice in{" "}
          <Link
            href={businessSettingsHref("train", "tools")}
            className="font-medium text-[#0096FF] underline-offset-2 transition-colors duration-150 hover:text-[#005ccc] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0096FF]/40"
          >
            Tools &amp; voice
          </Link>
          .
        </p>
      </section>
    </div>
  );
}
