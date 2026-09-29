import type { TranscriptRow } from "@/lib/supabase";

export type TranscriptSpeechSpeaker = "caller" | "agent";

export type TranscriptSpeechItem = {
  kind: "speech";
  id: string;
  speaker: TranscriptSpeechSpeaker;
  text: string;
  stamp: string | null;
  clustered: boolean;
  tail: boolean;
};

export type TranscriptFactItem = {
  kind: "fact";
  id: string;
  text: string;
};

export type TranscriptStreamItem = TranscriptSpeechItem | TranscriptFactItem;

const NOISE =
  /^(call (ended|started|connected|disconnected)|hangup|noise|silence|recording (saved|available))$/i;
const TOOL_MARK = /^\[[^\]]+\]$/;
const FALSE_CLAIM =
  /escalation sent|\brings\b|\bonline\b|last seen|active now/i;
const FAILED = /Needs human\. Notify failed/i;
const CHANNEL_SENT = /^(SMS|WhatsApp|Email)\b/i;
const ESCALATED_TO = /^Escalated to /i;

function speechSpeaker(raw: string): TranscriptSpeechSpeaker | null {
  const speaker = raw.toLowerCase();
  if (speaker === "caller") return "caller";
  if (speaker === "agent" || speaker === "assistant" || speaker === "receptionist") {
    return "agent";
  }
  return null;
}

function nairobiMinuteKey(iso: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "Africa/Nairobi",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

/** Compact Nairobi clock. One stamp per minute, not per bubble. */
export function formatTranscriptStamp(iso: string): string | null {
  try {
    const at = new Date(iso);
    if (Number.isNaN(at.getTime())) return null;
    return new Intl.DateTimeFormat("en-KE", {
      timeZone: "Africa/Nairobi",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    })
      .format(at)
      .replace(/\s?(am|pm)$/i, (_, mer: string) => ` ${mer.toUpperCase()}`);
  } catch {
    return null;
  }
}

/** Critic-true system copy: live channel + time, or failed. Not lifecycle theater. */
export function isHonestTranscriptFact(text: string): boolean {
  const line = text.replace(/\s+/g, " ").trim();
  if (!line) return false;
  if (FALSE_CLAIM.test(line)) return false;
  if (FAILED.test(line)) return true;
  if (ESCALATED_TO.test(line)) return true;
  if (CHANNEL_SENT.test(line) && /\bto\b/i.test(line)) return true;
  return false;
}

function normUtterance(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Caller STT often repeats the receptionist greeting. Drop that second copy. */
function isGreetingEcho(prev: string, next: string): boolean {
  const a = normUtterance(prev);
  const b = normUtterance(next);
  if (a.length < 12 || b.length < 12) return false;
  if (a === b) return true;
  const short = a.length <= b.length ? a : b;
  const long = a.length <= b.length ? b : a;
  return long.includes(short);
}

function keepSystemLine(text: string): boolean {
  const line = text.replace(/\s+/g, " ").trim();
  if (!line) return false;
  if (isHonestTranscriptFact(line)) return true;
  if (NOISE.test(line) || TOOL_MARK.test(line) || FALSE_CLAIM.test(line)) return false;
  return false;
}

/**
 * One conversation stream: speech bubbles plus honest system facts.
 * Drops lifecycle noise and duplicate per-turn chrome.
 */
export function buildCallTranscriptStream(
  turns: Pick<TranscriptRow, "id" | "created_at" | "speaker" | "text_content">[]
): TranscriptStreamItem[] {
  const kept: TranscriptStreamItem[] = [];
  let lastSpeech: TranscriptSpeechSpeaker | null = null;
  let lastSpeechText: string | null = null;
  let lastMinute: string | null = null;

  for (const turn of turns) {
    const text = String(turn.text_content || "").replace(/\s+/g, " ").trim();
    if (!text) continue;
    const speaker = speechSpeaker(String(turn.speaker || ""));
    if (!speaker) {
      if (!keepSystemLine(text)) continue;
      kept.push({ kind: "fact", id: turn.id, text });
      lastSpeech = null;
      lastSpeechText = null;
      continue;
    }
    if (lastSpeechText && isGreetingEcho(lastSpeechText, text)) continue;
    const minute = nairobiMinuteKey(turn.created_at);
    const clustered = lastSpeech === speaker;
    const stamp =
      lastMinute === minute ? null : formatTranscriptStamp(turn.created_at);
    if (stamp) lastMinute = minute;
    if (clustered && kept.length) {
      const prev = kept[kept.length - 1];
      if (prev.kind === "speech") prev.tail = false;
    }
    kept.push({
      kind: "speech",
      id: turn.id,
      speaker,
      text,
      stamp,
      clustered,
      tail: true,
    });
    lastSpeech = speaker;
    lastSpeechText = text;
  }

  return dropTrailingOpening(kept);
}

/** Closed calls sometimes append the opening agent line again. Drop that copy. */
function dropTrailingOpening(items: TranscriptStreamItem[]): TranscriptStreamItem[] {
  const speech = items.filter(
    (item): item is TranscriptSpeechItem => item.kind === "speech"
  );
  if (speech.length < 3) return items;
  const opening = speech.find((item) => item.speaker === "agent");
  const last = speech[speech.length - 1];
  if (!opening || opening.id === last.id || last.speaker !== "agent") return items;
  const openingText = normUtterance(opening.text);
  const lastText = normUtterance(last.text);
  if (openingText.length < 12 || openingText !== lastText) return items;
  const next = items.filter((item) => item.id !== last.id);
  for (let i = next.length - 1; i >= 0; i -= 1) {
    const row = next[i];
    if (row.kind !== "speech") continue;
    row.tail = true;
    break;
  }
  return next;
}
