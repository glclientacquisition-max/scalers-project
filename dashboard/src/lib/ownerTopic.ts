/**
 * summary.topic, Brain's owner text contract (#751,
 * docs/explanation/brain/CALLER_IDENTITY_AND_SUMMARY.md §2):
 * calls.summary.topic is string | null, mirrored in summary.owner_review.topic.
 * null = reviewed and nothing readable; key missing = not computed. In both
 * cases Desk shows no topic and never falls back to reason, goal or
 * brain_summary words. Relative imports only, so node tests load this directly.
 */

/** The topic when it is a non-empty string; otherwise null. */
export function summaryTopic(meta: Record<string, unknown> | null | undefined): string | null {
  if (!meta || typeof meta !== "object") return null;
  const pick = (raw: unknown) => (typeof raw === "string" ? raw.replace(/\s+/g, " ").trim() : "");
  let topic = pick(meta.topic);
  if (!topic && !("topic" in meta)) {
    const review = meta.owner_review;
    if (review && typeof review === "object") topic = pick((review as Record<string, unknown>).topic);
  }
  // A trailing full stop would read "about X.." in the opener.
  topic = topic.replace(/[.!?]+$/, "").trim();
  return topic || null;
}

/** Prefilled WhatsApp follow-up. Topic sentence only when Brain gave a topic. */
export function followUpWhatsAppText(opts: {
  businessName: string;
  name: string | null;
  topic: string | null | undefined;
}): string {
  const who = String(opts.name || "").trim() || "there";
  const biz = String(opts.businessName || "").trim() || "us";
  const topic = typeof opts.topic === "string" ? opts.topic.trim() : "";
  if (topic) return `Hi ${who}, this is ${biz}. Thanks for calling about ${topic}. How can we help you next?`;
  return `Hi ${who}, this is ${biz}. Thanks for calling. How can we help you?`;
}
