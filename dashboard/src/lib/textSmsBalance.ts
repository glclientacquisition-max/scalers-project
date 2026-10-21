/**
 * TextSMS credit read for the ops cron. getbalance only: this never sends an SMS.
 * The API key stays in the server request body and is never logged or returned.
 * Same field names as the Voice probe in src/notifications/sms.js.
 */

const DEFAULT_BALANCE_URL = "https://sms.textsms.co.ke/api/services/getbalance/";

export type TextSmsCreditRead = {
  /** Null when the account is not configured or the probe did not return a balance. */
  balance: number | null;
  /** HTTP 402 or provider code 1008 or 402. Callers treat that as zero credits. */
  exhausted: boolean;
};

function providerCode(json: unknown): number | null {
  if (!json || typeof json !== "object") return null;
  const row = json as Record<string, unknown>;
  const first = Array.isArray(row.responses) && row.responses.length ? row.responses[0] : null;
  const source = first && typeof first === "object" ? (first as Record<string, unknown>) : row;
  const raw = source["respose-code"] ?? source["response-code"] ?? source.responseCode ?? row["response-code"];
  const code = Number(raw);
  return Number.isFinite(code) ? code : null;
}

function balanceField(json: unknown): number | null {
  if (!json || typeof json !== "object") return null;
  const row = json as Record<string, unknown>;
  const raw = row.credit ?? row.balance ?? row["credit-balance"] ?? row.Credit;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

/** Pure parse. Ignores every field except the provider code and the credit number. */
export function parseTextSmsCredit(httpStatus: number, json: unknown): TextSmsCreditRead {
  const code = providerCode(json);
  if (httpStatus === 402 || code === 402 || code === 1008) return { balance: 0, exhausted: true };
  if (httpStatus !== 200 || code !== 200) return { balance: null, exhausted: false };
  const balance = balanceField(json);
  if (balance == null) return { balance: null, exhausted: false };
  return { balance, exhausted: balance <= 0 };
}

export function textSmsConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.TEXTSMS_API_KEY && env.TEXTSMS_PARTNER_ID);
}

/**
 * Server-side getbalance. Missing credentials or a failed probe return an unknown
 * balance so the cron neither alerts nor re-arms.
 */
export async function readTextSmsCredit(
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<TextSmsCreditRead> {
  if (!textSmsConfigured(env)) return { balance: null, exhausted: false };
  const url = env.TEXTSMS_BALANCE_URL || DEFAULT_BALANCE_URL;
  try {
    const res = await fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        apikey: env.TEXTSMS_API_KEY,
        partnerID: String(env.TEXTSMS_PARTNER_ID),
      }),
      signal: AbortSignal.timeout(8_000),
    });
    const json = await res.json().catch(() => null);
    return parseTextSmsCredit(res.status, json);
  } catch {
    return { balance: null, exhausted: false };
  }
}
