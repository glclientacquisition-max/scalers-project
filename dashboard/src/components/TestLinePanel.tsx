"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { businessSettingsHref } from "@/lib/businessSettingsNav";
import {
  lexiconForStorage,
  parseTtsLexicon,
} from "@/lib/pronunciationLexicon";
import { previewSpokenLine } from "@/lib/pronunciationPacks";
import {
  displaySonioxVoiceLabel,
  type CuratedSonioxVoice,
} from "@/lib/sonioxVoiceCatalog";
import type { TenantRow } from "@/lib/supabase";
import { settingsActionClass } from "@/components/settingsUi";

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
  const businessName = String(tenant.business_name || "").trim();
  const agentName = String(tenant.agent_name || "").trim() || "Receptionist";
  const sonioxVoiceId = String(tenant.soniox_voice_id || "").trim();
  const sonioxVoiceLabel = String(tenant.soniox_voice_label || "").trim();
  const lexicon = useMemo(
    () => parseTtsLexicon(tenant.tts_lexicon),
    [tenant.tts_lexicon]
  );

  const greetingPreview = useMemo(() => {
    const sample =
      agentName && businessName
        ? `Hello, you've reached ${businessName}, this is ${agentName} speaking. How can I help?`
        : businessName
          ? `Thank you for calling ${businessName}.`
          : "";
    if (!sample) return "";
    return previewSpokenLine(sample, lexicon);
  }, [businessName, agentName, lexicon]);

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
    <div className="space-y-8">
      <section className="rounded-2xl border border-[#0096FF]/30 bg-[#0096FF]/5 p-4 sm:p-6 sm:p-8">
        <h2 className="font-display tracking-tight text-[#005ccc] text-[clamp(1.25rem,4vw,1.5rem)]">
          Test line
        </h2>
        <p className="mt-2 max-w-xl text-sm text-ink-soft">
          Call your receptionist live, or play the opening greeting with your
          current voice and pronunciation.
        </p>

        {pendingDid ? (
          <p className="mt-6 text-sm text-ink-soft">Number pending.</p>
        ) : (
          <div className="mt-6">
            <p className="text-sm font-medium text-ink">Call from this device</p>
            <a
              href={`tel:${tenant.sautikit_virtual_number}`}
              className="mt-3 flex min-h-16 w-full items-center justify-center rounded-2xl bg-[#0096FF] px-4 py-5 text-center font-display text-[clamp(1.25rem,5vw,1.875rem)] font-semibold tracking-tight text-white shadow-sm transition hover:bg-[#0088e8] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0096FF]/40 focus-visible:ring-offset-2 [overflow-wrap:anywhere]"
            >
              {tenant.sautikit_virtual_number}
            </a>
          </div>
        )}
      </section>

      <section className="space-y-4">
        <div>
          <h3 className="font-display text-lg tracking-tight text-ink">
            Greeting preview
          </h3>
          <p className="mt-1 max-w-xl text-sm text-ink-soft">
            Hear how the first line sounds on the phone — same voice and
            pronunciation overrides callers get.
          </p>
        </div>

        {greetingPreview ? (
          <>
            <blockquote className="border-l-2 border-[#0096FF]/40 pl-4 text-sm leading-relaxed text-ink">
              “{greetingPreview}”
            </blockquote>

            {voiceLabel ? (
              <p className="text-xs text-ink-soft">
                Voice:{" "}
                <span className="font-medium text-ink">{voiceLabel}</span>
              </p>
            ) : null}

            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => playPhonePreview()}
                disabled={phonePreviewLoading}
                className={`${settingsActionClass} border-[#0096FF]/40 bg-white text-[#005ccc] hover:bg-[#0096FF]/5 disabled:opacity-60`}
              >
                {phonePreviewLoading ? "Generating…" : "Play phone preview"}
              </button>
              {phonePreviewUrl ? (
                <audio src={phonePreviewUrl} controls className="max-w-full" />
              ) : null}
            </div>

            {phonePreviewError ? (
              <p className="text-sm text-[var(--warn)]" role="alert">
                {phonePreviewError}
              </p>
            ) : null}
          </>
        ) : (
          <p className="text-sm text-ink-soft">
            Add a business name and agent name under{" "}
            <Link
              href={businessSettingsHref("train", "identity")}
              className="font-medium text-[#005ccc] underline-offset-2 hover:underline"
            >
              Agent Persona
            </Link>{" "}
            to preview the greeting.
          </p>
        )}

        <p className="text-xs text-ink-soft">
          Change the voice in{" "}
          <Link
            href={businessSettingsHref("train", "tools")}
            className="font-medium text-[#005ccc] underline-offset-2 hover:underline"
          >
            Tools &amp; voice
          </Link>
          , or fix how names sound in{" "}
          <Link
            href={businessSettingsHref("train", "pronunciation")}
            className="font-medium text-[#005ccc] underline-offset-2 hover:underline"
          >
            Pronunciation
          </Link>
          .
        </p>
      </section>
    </div>
  );
}
