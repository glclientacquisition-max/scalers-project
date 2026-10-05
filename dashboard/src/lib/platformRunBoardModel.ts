import type { SonioxHealthSnapshot, VoiceHealthFetch, VoiceHealthzPayload } from "@/lib/platformVoiceHealth";
import type { SautikitNumber, SautikitWallet } from "@/lib/sautikit";
import { formatMinor } from "@/lib/sautikit";

export type PlatformHealthTone = "ok" | "attention" | "neutral";

export type PlatformRowHealth = {
  tone: PlatformHealthTone;
  label: string;
  detail: string | null;
};

export type PlatformRowMoney = {
  primary: string;
  hint: string | null;
};

export type PlatformRunRow = {
  id: "phone" | "speech" | "reasoning";
  title: string;
  subtitle: string;
  health: PlatformRowHealth;
  money: PlatformRowMoney;
};

export type PhoneLineTelecomInput =
  | { status: "not_configured" }
  | { status: "error"; message: string }
  | {
      status: "ok";
      numbers: SautikitNumber[];
      wallet: SautikitWallet | null;
      walletHidden: boolean;
    };

function pickSonioxErrorDetail(snapshot: SonioxHealthSnapshot | undefined): string | null {
  if (!snapshot) return null;
  const channels = [snapshot.stt, snapshot.tts].filter(Boolean) as NonNullable<
    SonioxHealthSnapshot["stt"]
  >[];
  const billing = channels.find((c) => c.billing);
  const fatal = channels.find((c) => c.fatal);
  const recent = channels.find((c) => c.message && c.message !== "ok");
  const hit = billing || fatal || recent;
  if (!hit?.message || hit.message === "ok") return null;
  return hit.message;
}

export function deriveSpeechHealth(
  voice: VoiceHealthFetch | null,
): PlatformRowHealth {
  if (!voice || voice.status !== "ok") {
    const detail =
      voice?.status === "unreachable" || voice?.status === "invalid"
        ? voice.message
        : "Not connected";
    return { tone: "neutral", label: "Unknown", detail };
  }

  const soniox = voice.payload.soniox;
  const last = soniox?.lastError;
  if (last?.billingExhausted) {
    return {
      tone: "attention",
      label: "Degraded",
      detail: pickSonioxErrorDetail(last) || "Speech billing exhausted",
    };
  }

  const detail = pickSonioxErrorDetail(last);
  if (detail) {
    const fatal = Boolean(last?.stt?.fatal || last?.tts?.fatal);
    return {
      tone: fatal ? "attention" : "attention",
      label: "Degraded",
      detail,
    };
  }

  if (soniox?.stt === false && soniox?.tts === false) {
    return { tone: "neutral", label: "Unknown", detail: "Not connected" };
  }

  return { tone: "ok", label: "OK", detail: null };
}

export function deriveReasoningHealth(
  voice: VoiceHealthFetch | null,
): PlatformRowHealth {
  if (!voice || voice.status !== "ok") {
    const detail =
      voice?.status === "unreachable" || voice?.status === "invalid"
        ? voice.message
        : "Not connected";
    return { tone: "neutral", label: "Unknown", detail };
  }

  const gemini = voice.payload.gemini;
  const snap = gemini?.lastError;
  if (snap?.billingExhausted || snap?.denied || snap?.lastError?.kind === "billing") {
    return {
      tone: "attention",
      label: "Degraded",
      detail: snap?.lastError?.message || "Reasoning credits exhausted or denied",
    };
  }
  if (snap?.lastError?.kind === "denied") {
    return {
      tone: "attention",
      label: "Degraded",
      detail: snap.lastError.message || "Reasoning denied",
    };
  }
  if (snap?.lastError?.message) {
    return {
      tone: "attention",
      label: "Degraded",
      detail: snap.lastError.message,
    };
  }

  if (!gemini?.configured) {
    return { tone: "neutral", label: "Unknown", detail: "Not connected" };
  }

  return { tone: "ok", label: "OK", detail: null };
}

export function derivePhoneLineHealth(telecom: PhoneLineTelecomInput): PlatformRowHealth {
  if (telecom.status === "not_configured") {
    return {
      tone: "neutral",
      label: "Unknown",
      detail: "Not connected",
    };
  }
  if (telecom.status === "error") {
    return { tone: "attention", label: "Degraded", detail: telecom.message };
  }

  const { numbers } = telecom;
  const active = numbers.filter((n) => n.status === "active");
  const missingWebhook = active.filter((n) => !n.voice_callback_url);
  if (missingWebhook.length > 0) {
    return {
      tone: "attention",
      label: "Degraded",
      detail: "Line not connected",
    };
  }

  if (active.length === 0 && numbers.length === 0) {
    return { tone: "neutral", label: "Empty", detail: "No numbers" };
  }

  return { tone: "ok", label: "OK", detail: null };
}

export function derivePhoneLineMoney(telecom: PhoneLineTelecomInput): PlatformRowMoney {
  if (telecom.status !== "ok") {
    return { primary: "Unknown", hint: null };
  }

  const monthlyMinor = telecom.numbers.reduce(
    (sum, n) => (n.status === "active" ? sum + (n.monthly_retail_minor || 0) : sum),
    0,
  );
  const currency = telecom.numbers[0]?.currency || telecom.wallet?.currency || "KES";
  const rental =
    monthlyMinor > 0 ? `Line rental / month ${formatMinor(monthlyMinor, currency)}` : null;

  if (telecom.wallet) {
    return {
      primary: formatMinor(telecom.wallet.balance_minor, telecom.wallet.currency),
      hint: rental,
    };
  }
  if (telecom.walletHidden) {
    return {
      primary: "Unknown",
      hint: rental || "Balance needs wallet.read on the API key",
    };
  }
  return { primary: "Unknown", hint: rental };
}

export function speechMoneyLabel(): PlatformRowMoney {
  return { primary: "Unknown", hint: null };
}

export function reasoningMoneyLabel(): PlatformRowMoney {
  return { primary: "Unknown", hint: null };
}

export function platformRowPreview(row: PlatformRunRow): string | undefined {
  if (row.health.detail) return row.health.detail;
  if (row.money.primary && row.money.primary !== "Unknown") return row.money.primary;
  return undefined;
}

export function buildPlatformRunRows(opts: {
  telecom: PhoneLineTelecomInput;
  voice: VoiceHealthFetch | null;
}): PlatformRunRow[] {
  return [
    {
      id: "phone",
      title: "Phone line",
      subtitle: "Numbers and line wallet",
      health: derivePhoneLineHealth(opts.telecom),
      money: derivePhoneLineMoney(opts.telecom),
    },
    {
      id: "speech",
      title: "Speech",
      subtitle: "Voice",
      health: deriveSpeechHealth(opts.voice),
      money: speechMoneyLabel(),
    },
    {
      id: "reasoning",
      title: "Reasoning",
      subtitle: "Assistant",
      health: deriveReasoningHealth(opts.voice),
      money: reasoningMoneyLabel(),
    },
  ];
}

/** Test helper: map a raw healthz JSON body to speech/reasoning health. */
export function platformHealthFromPayload(payload: VoiceHealthzPayload): {
  speech: PlatformRowHealth;
  reasoning: PlatformRowHealth;
} {
  const voice: VoiceHealthFetch = { status: "ok", payload };
  return {
    speech: deriveSpeechHealth(voice),
    reasoning: deriveReasoningHealth(voice),
  };
}
