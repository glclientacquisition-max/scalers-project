/**
 * Email tokens. Light values mirror the Desk token table in
 * dashboard/src/app/globals.css (:root); dark values mirror its dark block.
 * Email clients can't read CSS variables, so the hex values are copied here.
 * When the Desk palette changes, change both.
 */
export const light = {
  canvas: "#f4f7fb",
  surface: "#ffffff",
  surface2: "#e9eef5",
  hairline: "#dde4ee",
  ink: "#0a192f",
  ink2: "#4a5b73",
  ink3: "#5b6d85",
  accent: "#005ccc",
  accentOn: "#ffffff",
  accentTonal: "#e3eeff",
  brand: "#0096ff",
  attention: "#b13a0a",
  attentionTonal: "#fdf0e8",
  ok: "#15803d",
  okTonal: "#e8f5ee",
  /** Environment band: production is red so it is never mistaken for staging. */
  danger: "#b91c1c",
  dangerOn: "#ffffff",
  bandNeutral: "#5b6d85",
  bandNeutralOn: "#ffffff",
} as const;

export const dark = {
  canvas: "#0b1220",
  surface: "#121c2c",
  surface2: "#1a2638",
  hairline: "#24324a",
  ink: "#e9eff7",
  ink2: "#9dafc6",
  ink3: "#8496b0",
  accent: "#3d9bff",
  accentOn: "#071426",
  accentTonal: "#12294a",
  brand: "#2aa8ff",
  attention: "#f4955a",
  attentionTonal: "#2b1a12",
  ok: "#4ade80",
  okTonal: "#122a1c",
  danger: "#dc2626",
  dangerOn: "#ffffff",
  bandNeutral: "#3a4a62",
  bandNeutralOn: "#e9eff7",
} as const;

/** Desk --font-sans. No web fonts: they fail in Outlook and slow Gmail. */
export const fontStack =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

export const layout = {
  maxWidth: 600,
  cardPadding: 32,
  cardPaddingMobile: 20,
  radius: 12,
  buttonHeight: 48,
} as const;

export type Tone = "info" | "ok" | "attention" | "neutral";

export function toneColors(tone: Tone) {
  switch (tone) {
    case "ok":
      return { fg: light.ok, bg: light.okTonal, cls: "ok" };
    case "attention":
      return { fg: light.attention, bg: light.attentionTonal, cls: "att" };
    case "info":
      return { fg: light.accent, bg: light.accentTonal, cls: "info" };
    default:
      return { fg: light.ink2, bg: light.surface2, cls: "neu" };
  }
}
