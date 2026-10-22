/** Words that must never reach an Admin screen: vendors, infrastructure, filler. Spec: OPS.md §5. */
export const OPS_BANNED_WORDS = [
  "supabase", "vercel", "railway", "twilio", "sautikit", "openai", "anthropic", "deepgram", "elevenlabs",
  "resend", "postgres", "postgrest", "rpc", "jwt", "coming soon", "oops", "something went wrong", "lorem",
] as const;

export function findBannedWords(text: string): string[] {
  const t = text.toLowerCase();
  return OPS_BANNED_WORDS.filter((w) => new RegExp(`\\b${w}\\b`).test(t));
}
