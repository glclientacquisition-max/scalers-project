// Pure model for the Super Admin Platform (provider health) page.
// No fetches here: the page loads Voice /admin/health + Supabase and hands
// the results in, so this file is unit-testable.

import type { VoiceEnv, VoiceHealthFetch, VoiceHealthzPayload } from "@/lib/platformVoiceHealth";
import { deriveReasoningHealth, deriveSpeechHealth } from "@/lib/platformRunBoardModel";

export type HealthState = "ok" | "degraded" | "down" | "unknown";
export type Owner = "Alvin" | "Ops" | "Platform";

export const STATE_WORD: Record<HealthState, string> = {
  ok: "OK",
  degraded: "Degraded",
  down: "Down",
  unknown: "Unknown",
};

export type ProviderId = "voice" | "sautikit" | "soniox" | "gemini" | "textsms" | "whatsapp" | "resend" | "supabase";

export type ProviderCard = {
  id: ProviderId;
  env: VoiceEnv;
  name: string;
  /** A failure here stops or degrades live calls. Only these drive the banner. */
  carriesCalls: boolean;
  state: HealthState;
  /** "Balance unknown" when the provider has no balance API we read. */
  balance: string;
  runway: string | null;
  checkedAt: string | null;
  /** Plain-language problem, one line in the card, full text in the panel. */
  error: string | null;
  link: { href: string; label: string };
  scopes: { scope: string; ok: boolean }[] | null;
  shared: boolean;
  owner: Owner;
};

/** One account serves prod and staging, so top up once. */
export const SHARED_ACCOUNTS: ReadonlySet<ProviderId> = new Set(["textsms"]);

/** A check older than this counts as Unknown (about 2x its probe interval). */
export const STALE_MS: Partial<Record<ProviderId, number>> = {
  sautikit: 30 * 60_000,
  soniox: 60 * 60_000,
  textsms: 90 * 60_000,
};

const LINKS: Record<ProviderId, { href: string; label: string }> = {
  voice: { href: "https://railway.com/dashboard", label: "Railway" },
  sautikit: { href: "https://sautikit.com", label: "SautiKit wallet" },
  soniox: { href: "https://console.soniox.com", label: "Soniox billing" },
  gemini: { href: "https://aistudio.google.com/usage", label: "Google AI usage" },
  textsms: { href: "https://sms.textsms.co.ke", label: "TextSMS top-up" },
  whatsapp: { href: "https://business.facebook.com/billing_hub", label: "Meta billing" },
  resend: { href: "https://resend.com/emails", label: "Resend" },
  supabase: { href: "https://supabase.com/dashboard", label: "Supabase" },
};

const RANK: Record<HealthState, number> = { down: 3, degraded: 2, unknown: 1, ok: 0 };

export function worstState(states: HealthState[]): HealthState {
  return states.reduce<HealthState>((acc, s) => (RANK[s] > RANK[acc] ? s : acc), "ok");
}

export function isStale(checkedAt: string | null | undefined, maxAgeMs: number | undefined, now: number): boolean {
  if (!maxAgeMs) return false;
  if (!checkedAt) return true;
  const t = Date.parse(checkedAt);
  return !Number.isFinite(t) || now - t > maxAgeMs;
}

function card(
  base: Omit<ProviderCard, "link" | "shared" | "balance" | "runway" | "scopes"> &
    Partial<Pick<ProviderCard, "balance" | "runway" | "scopes">>,
  now: number,
): ProviderCard {
  const out: ProviderCard = {
    balance: "Balance unknown",
    runway: null,
    scopes: null,
    ...base,
    link: LINKS[base.id],
    shared: SHARED_ACCOUNTS.has(base.id),
  };
  if (out.state !== "unknown" && isStale(out.checkedAt, STALE_MS[out.id], now)) {
    out.state = "unknown";
    out.error = out.checkedAt ? "Last check is stale." : "Not checked yet.";
  }
  return out;
}

function formatKes(minor: number, currency = "KES"): string {
  return `${currency} ${(minor / 100).toLocaleString("en-KE", { maximumFractionDigits: 2 })}`;
}

const missing = (scopes: { scope: string; ok: boolean }[] | null, names: string[]) =>
  (scopes || []).filter((s) => names.includes(s.scope) && !s.ok).map((s) => s.scope);

/** Build every provider card for one Voice environment. */
export function buildProviderCards(
  env: VoiceEnv,
  voice: VoiceHealthFetch,
  opts: { supabaseOk?: boolean | null; now?: number } = {},
): ProviderCard[] {
  const now = opts.now ?? Date.now();
  if (voice.status !== "ok") {
    return [
      card(
        {
          id: "voice",
          env,
          name: "Voice server",
          carriesCalls: true,
          state: voice.status === "invalid" ? "unknown" : "down",
          checkedAt: new Date(now).toISOString(),
          error: voice.message,
          owner: "Platform",
        },
        now,
      ),
    ];
  }
  const p: VoiceHealthzPayload = voice.payload;
  const liveAt = p.checkedAt ?? new Date(now).toISOString();
  const scopes = p.keyScopes?.sautikit?.checks ?? null;
  const cards: ProviderCard[] = [];

  cards.push(
    card({ id: "voice", env, name: "Voice server", carriesCalls: true, state: "ok", checkedAt: liveAt, error: null, owner: "Platform" }, now),
  );

  // SautiKit: wallet + key scopes for the line itself.
  const tel = p.telephony?.lastError ?? null;
  const lineMissing = missing(scopes, ["wallet.read", "numbers.read", "calls.read", "recordings.read"]);
  let telState: HealthState = "unknown";
  let telError: string | null = null;
  if (!p.telephony?.configured) {
    telError = "SautiKit key not set on Voice.";
  } else if (tel?.billingExhausted) {
    telState = "down";
    telError = "Phone wallet is empty. Calls are rejected.";
  } else if (tel?.message && tel.message !== "ok") {
    telState = "degraded";
    telError = /403/.test(tel.message) ? "Wallet check refused (key is missing wallet.read)." : tel.message;
  } else if (tel?.at) {
    telState = "ok";
  }
  if (telState === "ok" && lineMissing.length) {
    telState = "degraded";
    telError = `Key is missing ${lineMissing.join(", ")}.`;
  }
  cards.push(
    card(
      {
        id: "sautikit",
        env,
        name: "Phone line (SautiKit)",
        carriesCalls: true,
        state: telState,
        balance: tel?.balanceMinor != null ? formatKes(tel.balanceMinor, tel.currency || "KES") : "Balance unknown",
        checkedAt: tel?.at ?? null,
        error: telError,
        scopes,
        owner: "Alvin",
      },
      now,
    ),
  );

  // Soniox: live call errors (derive*Health) + balance probe.
  const speech = deriveSpeechHealth(voice);
  const sb = p.sonioxBalance;
  let sonState: HealthState = speech.tone === "attention" ? "degraded" : "ok";
  let sonError = speech.tone === "attention" ? speech.detail : null;
  const sonioxLast = p.soniox?.lastError;
  if (sonioxLast?.billingExhausted || sb?.state === "exhausted") {
    sonState = "down";
    sonError = sb?.error || "Speech balance is spent. Callers hear the outage message.";
  } else if (sb?.state === "critical" || sb?.state === "warn") {
    sonState = worstState([sonState, "degraded"]);
    sonError = sonError || sb.error || null;
  } else if (!sb?.configured) {
    sonError = sonError || "Balance not checked (SONIOX_ADMIN_KEY not set).";
  }
  cards.push(
    card(
      {
        id: "soniox",
        env,
        name: "Speech (Soniox)",
        carriesCalls: true,
        state: sonState,
        balance: sb?.balanceUsd != null ? `USD ${sb.balanceUsd}${sb.autopay ? " · autopay on" : " · autopay off"}` : "Balance unknown",
        checkedAt: sb?.configured ? sb.checkedAt ?? null : liveAt,
        error: sonError,
        owner: "Alvin",
      },
      now,
    ),
  );

  const reasoning = deriveReasoningHealth(voice);
  const gemDown = Boolean(p.gemini?.lastError?.billingExhausted || p.gemini?.lastError?.denied);
  cards.push(
    card(
      {
        id: "gemini",
        env,
        name: "Reasoning (Gemini)",
        carriesCalls: true,
        state: gemDown ? "down" : reasoning.tone === "attention" ? "degraded" : p.gemini?.configured === false ? "down" : "ok",
        checkedAt: liveAt,
        error: gemDown ? "Reasoning is out of credit or denied. Calls take names only." : reasoning.detail,
        owner: "Alvin",
      },
      now,
    ),
  );

  const sms = p.sms;
  const smsState: HealthState =
    !sms || sms.configured === false
      ? "unknown"
      : sms.state === "exhausted"
        ? "down"
        : sms.state === "critical" || sms.state === "warn"
          ? "degraded"
          : sms.state === "ok"
            ? "ok"
            : "unknown";
  cards.push(
    card(
      {
        id: "textsms",
        env,
        name: "SMS (TextSMS)",
        carriesCalls: false,
        state: smsState,
        balance: sms?.balance != null ? `${sms.balance} units` : "Balance unknown",
        runway: sms?.runwayDays != null ? `~${sms.runwayDays} days` : null,
        checkedAt: sms?.checkedAt ?? null,
        error:
          smsState === "down"
            ? "Out of SMS credit. Owner texts fall back to WhatsApp or email."
            : smsState === "degraded"
              ? "SMS credit is low."
              : sms?.configured === false
                ? "TextSMS not set on Voice."
                : null,
        owner: "Alvin",
      },
      now,
    ),
  );

  const waMissing = missing(scopes, ["whatsapp.messages"]);
  cards.push(
    card(
      {
        id: "whatsapp",
        env,
        name: "WhatsApp (SautiKit / Meta)",
        carriesCalls: false,
        state: !p.notify?.whatsapp ? "unknown" : waMissing.length ? "down" : "ok",
        checkedAt: liveAt,
        error: !p.notify?.whatsapp
          ? "WhatsApp sender not set on Voice."
          : waMissing.length
            ? "Key is missing whatsapp.messages. WhatsApp alerts fail."
            : null,
        owner: "Alvin",
      },
      now,
    ),
  );

  cards.push(
    card(
      {
        id: "resend",
        env,
        name: "Email (Resend)",
        carriesCalls: false,
        state: p.notify?.email ? "ok" : "down",
        checkedAt: liveAt,
        error: p.notify?.email ? null : "Email fallback not set (RESEND_API_KEY + ALERT_EMAIL_FROM).",
        owner: "Ops",
      },
      now,
    ),
  );

  if (env === "prod" && opts.supabaseOk != null) {
    cards.push(
      card(
        {
          id: "supabase",
          env,
          name: "Database (Supabase)",
          carriesCalls: true,
          state: opts.supabaseOk ? "ok" : "down",
          checkedAt: new Date(now).toISOString(),
          error: opts.supabaseOk ? null : "Desk could not read the calls table.",
          owner: "Platform",
        },
        now,
      ),
    );
  }
  return cards;
}

export type PinnedLine = {
  e164: string;
  business: string | null;
  status: string | null;
};

export type Banner = {
  state: HealthState;
  headline: string;
  reason: string | null;
  owner: Owner | null;
  pinned: PinnedLine | null;
};

export const PINNED_DID = "+254709221536";

/** "Can calls go through" from prod call-carrying providers only. */
export function computeBanner(prodCards: ProviderCard[], pinned: PinnedLine | null): Banner {
  const carrying = prodCards.filter((c) => c.carriesCalls);
  const worst = carrying
    .filter((c) => c.state !== "ok")
    .sort((a, b) => RANK[b.state] - RANK[a.state])[0];
  const pinnedProblem =
    pinned && (pinned.status !== "assigned" || !pinned.business)
      ? `Aris line ${pinned.e164} is ${pinned.status || "missing"}.`
      : null;
  if (!worst && !pinnedProblem) {
    return { state: "ok", headline: "Calls go through", reason: null, owner: null, pinned };
  }
  if (!worst) {
    return { state: "degraded", headline: "Calls go through, one line needs a look", reason: pinnedProblem, owner: "Ops", pinned };
  }
  const headline =
    worst.state === "down"
      ? worst.id === "soniox"
        ? "Calls connect but callers hear the outage message"
        : worst.id === "gemini"
          ? "Calls go through, names only"
          : "Calls are not going through"
      : worst.state === "degraded"
        ? "Calls go through, degraded"
        : "Can't confirm calls go through";
  return {
    state: worst.state,
    headline,
    reason: `${worst.name}: ${worst.error || STATE_WORD[worst.state]}`,
    owner: worst.owner,
    pinned,
  };
}

export type FixItem = { key: string; text: string; owner: Owner; state: HealthState; env: VoiceEnv; href: string };

/** Ranked to-fix list: call-carrying + prod first, then severity. Shared accounts once. */
export function buildFixList(cards: ProviderCard[]): FixItem[] {
  const seen = new Set<string>();
  const items = cards
    .filter((c) => c.state !== "ok")
    .sort(
      (a, b) =>
        Number(b.carriesCalls) - Number(a.carriesCalls) ||
        Number(a.env === "staging") - Number(b.env === "staging") ||
        RANK[b.state] - RANK[a.state],
    )
    .filter((c) => {
      const key = c.shared ? c.id : `${c.env}:${c.id}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  return items.map((c) => ({
    key: `${c.env}:${c.id}`,
    text: `${c.name}${c.shared ? " (shared)" : ` (${c.env === "prod" ? "Production" : "Staging"})`}: ${c.error || STATE_WORD[c.state]}`,
    owner: c.owner,
    state: c.state,
    env: c.env,
    href: c.link.href,
  }));
}

export type CallStats = { lastHour: number; lastDay: number; answeredPct: number | null };

export function answeredPct(total: number, abandoned: number | null): number | null {
  if (abandoned == null || total <= 0) return null;
  return Math.round(((total - abandoned) / total) * 100);
}

/** "3 min ago" style. Absolute time goes in the title attribute. */
export function relativeTime(iso: string | null | undefined, now: number = Date.now()): string {
  if (!iso) return "never";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "never";
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}

export function absoluteEat(iso: string | null | undefined): string {
  if (!iso) return "Never checked";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "Never checked";
  return `${d.toLocaleString("en-GB", { timeZone: "Africa/Nairobi", dateStyle: "medium", timeStyle: "short" })} EAT`;
}
