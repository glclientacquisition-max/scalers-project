/**
 * Environment tag for any email, shared with the layout (Layout.tsx renders
 * spec.band). One helper so every template tags the same way:
 *   subject prefix "[PRODUCTION] " or "[STAGING] ", and a band at the top
 *   (red for production, neutral grey for staging).
 * Tag by what the email is about (which workspace, which wallet), not by the
 * host that sends it: prod Desk also sends staging alerts.
 */
import type { EmailSpec } from "./spec.ts";

export type EmailEnv = "production" | "staging";
export type EmailBand = { tone: EmailEnv; text: string };

export function envTag(env: EmailEnv): "[PRODUCTION]" | "[STAGING]" {
  return env === "production" ? "[PRODUCTION]" : "[STAGING]";
}

/** "[STAGING] Subject". Idempotent: an already tagged subject is returned as is. */
export function envSubject(env: EmailEnv, subject: string): string {
  const tag = envTag(env);
  const bare = subject.replace(/^\[(PRODUCTION|STAGING)\]\s*/, "");
  return `${tag} ${bare}`;
}

/** Band text "PRODUCTION · live calls". The note says what is at stake in that environment. */
export function envBand(env: EmailEnv, note?: string): EmailBand {
  const label = env === "production" ? "PRODUCTION" : "STAGING";
  return { tone: env, text: note ? `${label} · ${note}` : label };
}

/** Tag a whole spec: subject prefix plus band. */
export function withEnv(spec: EmailSpec, env: EmailEnv, note?: string): EmailSpec {
  return { ...spec, subject: envSubject(env, spec.subject), band: envBand(env, note) };
}
