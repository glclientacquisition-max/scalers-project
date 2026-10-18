/**
 * Call forwarding codes for the "Set up your calls" step (/onboarding/line).
 * Source of every code: Ops research 18 Oct 2026 (kenya_call_forwarding_research.md)
 * and the owner guide. Standard network codes, the same on Safaricom, Airtel and Telkom.
 *
 * Rules (unit tested in tests/callForwarding.test.ts):
 * - Ring time uses a double star (empty service slot): **61*N**20#. A single star
 *   puts the seconds in the service slot and voice may not forward.
 * - Never build **21* or **002*N# (they forward every call, so the phone stops ringing).
 * - tel: links encode # as %23, or the dialer cuts the code off. Android only:
 *   iPhone blocks links that turn on forwarding.
 * - The number in a code is local 07/01 form with no spaces.
 */

export type ForwardChoice = "all" | "no_answer" | "busy" | "off";
export type PhoneKind = "android" | "iphone";
export type NetworkId = "safaricom" | "airtel" | "telkom";

export const FORWARD_CHOICES: readonly ForwardChoice[] = ["all", "no_answer", "busy", "off"];
export const SEPARATE_CHOICES: readonly ForwardChoice[] = ["no_answer", "busy", "off"];
export const NETWORKS: readonly NetworkId[] = ["safaricom", "airtel", "telkom"];
export const RING_OPTIONS = [15, 20, 30] as const;
export type RingSeconds = (typeof RING_OPTIONS)[number];
export const DEFAULT_RING: RingSeconds = 20;

/** Turns off every forward, including old voicemail forwards. */
export const ALL_OFF_CODE = "##002#";

/** +254 709 000 123, 254709000123, 709000123 or 0709 000 123 -> 0709000123. Null when not a Kenyan number. */
export function toLocal07(raw: unknown): string | null {
  const digits = String(raw ?? "").replace(/[\s()-]/g, "");
  let m = /^\+?254(\d{9})$/.exec(digits);
  if (m) return `0${m[1]}`;
  m = /^0(\d{9})$/.exec(digits);
  if (m) return `0${m[1]}`;
  m = /^([17]\d{8})$/.exec(digits);
  if (m) return `0${m[1]}`;
  return null;
}

export function ringSeconds(value: unknown): RingSeconds {
  const n = Number(value);
  return (RING_OPTIONS as readonly number[]).includes(n) ? (n as RingSeconds) : DEFAULT_RING;
}

/** Turn-on code for one choice. `number` must already be local 07 form. */
export function forwardOnCode(choice: ForwardChoice, number: string, ring: RingSeconds = DEFAULT_RING): string {
  const s = ringSeconds(ring);
  switch (choice) {
    case "all":
      return `**004*${number}**${s}#`;
    case "no_answer":
      return `**61*${number}**${s}#`;
    case "busy":
      return `**67*${number}#`;
    case "off":
      return `**62*${number}#`;
  }
}

export function forwardOffCode(choice: ForwardChoice): string {
  switch (choice) {
    case "all":
      return "##004#";
    case "no_answer":
      return "##61#";
    case "busy":
      return "##67#";
    case "off":
      return "##62#";
  }
}

/** "If it didn't work": voice-only ring time, then the network's normal ring time. */
export function noAnswerFallbackCodes(number: string, ring: RingSeconds = DEFAULT_RING): string[] {
  return [`**61*${number}*11*${ringSeconds(ring)}#`, `**61*${number}#`];
}

/** Check what's on. */
export const CHECK_CODES = ["*#61#", "*#67#", "*#62#"] as const;

/** A code that would forward every call (owner's phone stops ringing). Never shown. */
export function forwardsEveryCall(code: string): boolean {
  return /^\*\*21\*/.test(code) || /^\*?\*002\*/.test(code);
}

/** tel: link for a code: # becomes %23, * stays. */
export function telHref(code: string): string {
  return `tel:${code.replace(/\s/g, "").replace(/#/g, "%23")}`;
}

/** Tap-to-dial is Android only. Unknown phone (not detected yet) gets no link. */
export function canTapToDial(phone: PhoneKind | null | undefined): boolean {
  return phone === "android";
}

/** Dial link for a code, or null where a link must not show. */
export function dialHref(code: string, phone: PhoneKind | null | undefined): string | null {
  if (!canTapToDial(phone) || forwardsEveryCall(code)) return null;
  return telHref(code);
}

export function phoneFromUserAgent(ua: string | null | undefined): PhoneKind {
  const s = String(ua || "");
  if (/iPhone|iPad|iPod/i.test(s)) return "iphone";
  // iPadOS reports as Mac with touch; treat as iPhone-like (no forwarding links).
  if (/Macintosh/i.test(s) && /Mobile\//.test(s)) return "iphone";
  return "android";
}

export const NETWORK_LABEL: Record<NetworkId, string> = {
  safaricom: "Safaricom",
  airtel: "Airtel",
  telkom: "Telkom",
};

export function networkHelpLine(network: NetworkId | null | undefined): string {
  if (network === "safaricom") return "Safaricom: call 100 (prepay) or 200 (postpay).";
  if (network === "airtel") return "Airtel: call customer care.";
  if (network === "telkom") return "Telkom: call customer care.";
  return "Safaricom: call 100 (prepay) or 200 (postpay). Airtel and Telkom: call customer care.";
}

export const CHOICE_COPY: Record<ForwardChoice, { title: string; line: (ring: RingSeconds) => string }> = {
  all: {
    title: "All of the above in one code",
    line: () => "Catches calls you don't answer, calls while you're busy, and calls when your phone is off.",
  },
  no_answer: {
    title: "When I don't answer",
    line: (ring) => `Your phone rings for about ${ring} seconds, then the assistant answers.`,
  },
  busy: {
    title: "When I'm busy or reject a call",
    line: () => "If you're on another call, or you press the red button, the assistant answers.",
  },
  off: {
    title: "When my phone is off or has no network",
    line: () => "If your phone is off, the battery is flat, or there's no signal, the assistant answers.",
  },
};

export function ringHelp(ring: RingSeconds): string {
  return `Your phone rings about ${ring} seconds before the assistant answers.`;
}
