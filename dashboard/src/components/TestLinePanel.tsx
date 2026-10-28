"use client";

import { useEffect, useMemo, useState } from "react";
import {
  lexiconForStorage,
  parseTtsLexicon,
} from "@/lib/pronunciationLexicon";
import { previewBusinessAssistantIntro } from "@/lib/businessAssistantIntro";
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
  const agentName = String(tenant.agent_name || "").trim() || "Business Assistant";
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
    // isKbLive: the line comes from the published snapshot (kb/source.js openerLine on the server), groups only,
    // never items or old notes, and never mixed with the stored row.
    const kbLine = typeof tenant.kb_offering_line === "string" ? tenant.kb_offering_line : null;
    const sample = previewBusinessAssistantIntro({
      businessName,
      spokenName: tenant.spoken_name,
      greetingInvite: tenant.greeting_invite,
      agentName,
      ...(kbLine != null
        ? { offeringLine: kbLine, servicesCatalog: [], servicesOffered: "" }
        : {
            servicesCatalog: Array.isArray(tenant.services_catalog) ? tenant.services_catalog : [],
            servicesOffered: tenant.services_offered,
          }),
    });
    // Raw greeting. The voice line applies pronunciation and tells us what it
    // said (X-Spoken-Text), so Desk never guesses how the line reads it.
    return sample;
  }, [
    businessName,
    agentName,
    tenant.spoken_name,
    tenant.greeting_invite,
    tenant.services_catalog,
    tenant.services_offered,
    tenant.kb_offering_line,
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
                {phonePreviewLoading ? "Generating…" : "Hear greeting"}
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
              ) : null}
              {phonePreviewUrl && spokenText && spokenText !== greetingPreview ? (
                <p className="text-meta text-ink-2">
                  Callers hear: <span className="text-ink">{spokenText}</span>
                </p>
              ) : phonePreviewError ? (
                <p className="text-body text-warn" role="alert">
                  {phonePreviewError}
                </p>
              ) : null}
            </>
          ) : null}
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
            <p className="text-body text-ink-2">Number pending.</p>
          )}
        </div>
      </SettingsGroup>
    </div>
  );
}
