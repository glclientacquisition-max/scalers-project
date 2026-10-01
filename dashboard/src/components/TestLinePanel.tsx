"use client";

import { useEffect, useMemo, useState } from "react";
import {
  lexiconForStorage,
  parseTtsLexicon,
} from "@/lib/pronunciationLexicon";
import {
  previewBusinessAssistantIntro,
  summarizeOfferingForIntro,
} from "@/lib/businessAssistantIntro";
import {
  formatHoursForCompiler,
  parseHoursSchedule,
} from "@/lib/hoursSchedule";
import {
  firstDialableTeammate,
  HANDOFF_OPTIONS,
  parseHandoffMode,
} from "@/lib/handoffMode";
import { handoffMessageLine } from "@/lib/deskLiveTransfer";
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

  const hoursLine = useMemo(() => {
    const schedule = parseHoursSchedule(tenant.hours_schedule);
    const formatted = formatHoursForCompiler(schedule);
    if (formatted) return formatted.replace(/\s+/g, " ").trim();
    return String(tenant.business_hours || "").replace(/\s+/g, " ").trim();
  }, [tenant.hours_schedule, tenant.business_hours]);

  const offerLine = useMemo(() => {
    const spoken = summarizeOfferingForIntro({
      servicesCatalog: Array.isArray(tenant.services_catalog)
        ? tenant.services_catalog
        : [],
      servicesOffered: tenant.services_offered,
    });
    if (spoken) return spoken.replace(/\s+/g, " ").trim();
    const products = Array.isArray(tenant.product_catalog)
      ? tenant.product_catalog
      : [];
    return (
      products
        .map((row) => String(row?.name || "").trim())
        .find(Boolean) || ""
    );
  }, [tenant.services_catalog, tenant.services_offered, tenant.product_catalog]);

  const handoffLine = useMemo(() => {
    const mode = parseHandoffMode(tenant.handoff_mode);
    const dest = firstDialableTeammate(
      Array.isArray(tenant.team_directory) ? tenant.team_directory : []
    );
    if (mode === "live_transfer") {
      return dest
        ? `Rings ${dest.name} during open hours.`
        : HANDOFF_OPTIONS.find((opt) => opt.id === mode)?.label || "";
    }
    return dest
      ? handoffMessageLine(dest.name)
      : HANDOFF_OPTIONS.find((opt) => opt.id === "callback")?.label || "";
  }, [tenant.handoff_mode, tenant.team_directory]);

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
            <blockquote className="border-l-2 border-accent/50 pl-4 text-base leading-relaxed text-ink">
              “{greetingPreview}”
            </blockquote>
          ) : null}
          {hoursLine ? (
            <p className="min-w-0 truncate text-sm text-ink">{hoursLine}</p>
          ) : null}
          {offerLine ? (
            <p className="min-w-0 truncate text-sm text-ink">{offerLine}</p>
          ) : null}
          {handoffLine ? (
            <p className="min-w-0 truncate text-sm text-ink">{handoffLine}</p>
          ) : null}
          {greetingPreview ? (
            <>
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
            <p className="text-sm text-ink-soft">Number pending.</p>
          )}
        </div>
      </SettingsGroup>
    </div>
  );
}
