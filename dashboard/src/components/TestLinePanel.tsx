"use client";

import { useEffect, useMemo, useState } from "react";
import {
  lexiconForStorage,
  parseTtsLexicon,
} from "@/lib/pronunciationLexicon";
import { playedGreetingFromTenant } from "@/lib/identityGreeting";
import {
  displaySonioxVoiceLabel,
  resolveLiveCallVoiceId,
  type CuratedSonioxVoice,
} from "@/lib/sonioxVoiceCatalog";
import type { TenantRow } from "@/lib/supabase";
import { KbPendingNote } from "@/components/KbPendingNote";
import {
  assertPreviewAudioPlayable,
  NO_VOICE_SAMPLE_COPY,
  objectUrlFromPreviewResponse,
  previewErrorCopy,
} from "@/lib/previewAudio";
import Link from "next/link";
import { businessSettingsHref } from "@/lib/businessSettingsNav";
import { formatKenyaNumber } from "@/lib/setupFlow";
import { testLineQuestions } from "@/lib/testLineQuestions";
import { Button, buttonClass } from "@/components/ui/Button";
import { SettingsGroup } from "@/components/settingsUi";

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
  const sonioxVoiceId = resolveLiveCallVoiceId(
    tenant.soniox_voice_id,
    curatedVoices
  );
  const sonioxVoiceLabel = String(tenant.soniox_voice_label || "").trim();
  const lexicon = useMemo(
    () => parseTtsLexicon(tenant.tts_lexicon),
    [tenant.tts_lexicon]
  );

  const greetingPreview = useMemo(
    () => playedGreetingFromTenant(tenant),
    [tenant],
  );

  const questions = useMemo(
    () =>
      testLineQuestions({
        faqs: tenant.faqs,
        services: tenant.services_catalog,
        products: tenant.product_catalog,
      }),
    [tenant.faqs, tenant.services_catalog, tenant.product_catalog]
  );
  const prettyNumber = lineLive ? formatKenyaNumber(did) : "";

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
  const [spokenText, setSpokenText] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      if (phonePreviewUrl) URL.revokeObjectURL(phonePreviewUrl);
    };
  }, [phonePreviewUrl]);

  async function generatePhonePreview() {
    if (!greetingPreview) return;
    setPhonePreviewLoading(true);
    setPhonePreviewError(null);
    setSpokenText(null);
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
          greeting: true,
        }),
        // Server gives up at 15s; this only covers a dropped connection.
        signal: AbortSignal.timeout(20_000),
      });
      const spokenHeader = res.headers.get("x-spoken-text");
      if (spokenHeader) {
        try {
          setSpokenText(decodeURIComponent(spokenHeader));
        } catch {
          setSpokenText(spokenHeader);
        }
      }
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
          <KbPendingNote pending={tenant.kb_pending === true && typeof tenant.kb_offering_line === "string"} />
          {greetingPreview ? (
            <blockquote className="border-l-2 border-accent/50 pl-4 text-body leading-relaxed text-ink">
              “{greetingPreview}”
            </blockquote>
          ) : (
            <p className="text-body text-ink-2" role="status">
              Add a business name in{" "}
              <Link
                href={businessSettingsHref("train", "identity")}
                className="font-medium text-accent-deep underline-offset-2 hover:underline"
              >
                Identity
              </Link>{" "}
              to preview the greeting.
            </p>
          )}
          {greetingPreview ? (
            <>
              {voiceLabel ? (
                <p className="text-meta text-ink-2">
                  Voice · <span className="text-ink">{voiceLabel}</span>
                </p>
              ) : null}
              {lexicon.length ? (
                <p className="text-meta text-ink-2">
                  <Link
                    href={businessSettingsHref("train", "pronunciation")}
                    className="font-medium text-accent"
                  >
                    {lexicon.length} {lexicon.length === 1 ? "word" : "words"} set in Pronunciation
                  </Link>
                </p>
              ) : null}
            </>
          ) : null}
        </div>
      </SettingsGroup>

      <SettingsGroup title="Line">
        <div className="flex flex-wrap items-center gap-2 px-4 py-3">
          {lineLive ? (
            <a href={`tel:${did}`} className={buttonClass({ size: "md" })}>
              Call {prettyNumber}
            </a>
          ) : (
            <p className="text-body text-ink-2">Number pending.</p>
          )}
          {greetingPreview ? (
            <Button
              type="button"
              variant="tonal"
              size="md"
              pending={phonePreviewLoading}
              onClick={() => generatePhonePreview()}
            >
              {phonePreviewLoading ? "Generating…" : "Hear greeting"}
            </Button>
          ) : null}
        </div>
        {phonePreviewUrl ? (
          <div className="space-y-3 px-4 pb-3">
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
            {spokenText && spokenText !== greetingPreview ? (
              <p className="text-meta text-ink-2">
                Callers hear: <span className="text-ink">{spokenText}</span>
              </p>
            ) : phonePreviewError ? (
              <p className="text-body text-warn" role="alert">
                {phonePreviewError}
              </p>
            ) : null}
          </div>
        ) : phonePreviewError ? (
          <p className="px-4 pb-3 text-body text-warn" role="alert">
            {phonePreviewError}
          </p>
        ) : null}
      </SettingsGroup>

      {questions.length ? (
        <SettingsGroup title="Questions">
          <ul className="divide-y divide-hairline">
            {questions.map((question) => (
              <li key={question} className="px-4 py-3 text-body text-ink">
                {question}
              </li>
            ))}
          </ul>
        </SettingsGroup>
      ) : null}
    </div>
  );
}
