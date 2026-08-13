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
import { audioBlobFromPreviewResponse } from "@/lib/previewAudio";

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
      const blob = await audioBlobFromPreviewResponse(res);
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
    <div className="mx-auto max-w-xl space-y-10">
      <header className="space-y-2">
        <h2 className="font-display text-[clamp(1.5rem,4vw,2rem)] tracking-tight text-[var(--ink)]">
          Test
        </h2>
        <p className="text-sm text-[var(--ink-soft)]">
          Hear how your assistant introduces the business — brand, agent, what
          you offer, and that callers can use English or Kiswahili — with your
          current voice and pronunciations.
        </p>
      </header>

      <section className="space-y-4" aria-labelledby="test-preview-heading">
        <h3
          id="test-preview-heading"
          className="text-sm font-medium text-[var(--ink)]"
        >
          Phone preview
        </h3>

        {greetingPreview ? (
          <>
            <blockquote className="border-l-2 border-[var(--accent)]/50 pl-4 text-base leading-relaxed text-[var(--ink)]">
              “{greetingPreview}”
            </blockquote>
            {voiceLabel ? (
              <p className="text-xs text-[var(--ink-soft)]">
                Voice · <span className="text-[var(--ink)]">{voiceLabel}</span>
                {lexicon.length
                  ? ` · ${lexicon.length} pronunciation override${lexicon.length === 1 ? "" : "s"}`
                  : null}
              </p>
            ) : null}

            <button
              type="button"
              onClick={() => playPhonePreview()}
              disabled={phonePreviewLoading}
              className="w-full rounded-2xl bg-[var(--accent)] px-4 py-3.5 text-center text-sm font-semibold text-white hover:bg-[var(--accent-deep)] disabled:opacity-60 sm:w-auto sm:min-w-[12rem]"
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
              <p className="text-sm text-[var(--warn)]" role="alert">
                {phonePreviewError}
              </p>
            ) : null}
          </>
        ) : (
          <p className="text-sm text-[var(--ink-soft)]">
            Add a business name and agent name in{" "}
            <Link
              href={businessSettingsHref("train", "identity")}
              className="font-medium text-[var(--accent)] underline-offset-2 hover:underline"
            >
              Agent Persona
            </Link>{" "}
            to preview the greeting.
          </p>
        )}
      </section>

      <section className="space-y-3 border-t border-[var(--line)] pt-8" aria-labelledby="test-call-heading">
        <h3
          id="test-call-heading"
          className="text-sm font-medium text-[var(--ink)]"
        >
          Live call
        </h3>
        {pendingDid || !did ? (
          <p className="text-sm text-[var(--ink-soft)]">
            Number pending — finish setup before calling.
          </p>
        ) : (
          <a
            href={`tel:${did}`}
            className="flex min-h-14 w-full items-center justify-center rounded-2xl border border-[var(--line)] bg-white px-4 py-4 text-center font-display text-[clamp(1.15rem,4vw,1.5rem)] tracking-tight text-[var(--ink)] transition hover:border-[var(--accent)]"
          >
            {did}
          </a>
        )}
        <p className="text-xs text-[var(--ink-soft)]">
          Fix names in{" "}
          <Link
            href={businessSettingsHref("train", "pronunciation")}
            className="font-medium text-[var(--accent)] underline-offset-2 hover:underline"
          >
            Pronunciation
          </Link>
          {" · "}
          change voice in{" "}
          <Link
            href={businessSettingsHref("train", "tools")}
            className="font-medium text-[var(--accent)] underline-offset-2 hover:underline"
          >
            Tools &amp; voice
          </Link>
          .
        </p>
      </section>
    </div>
  );
}
