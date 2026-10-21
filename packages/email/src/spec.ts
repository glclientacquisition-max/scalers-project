import type { Tone } from "./tokens.ts";

/** Inline text: plain strings plus bold runs. Kept tiny so copy stays readable. */
export type Inline = string | { strong: string } | { link: string; href: string };
export type Rich = Inline | Inline[];

export type Block =
  | { t: "p"; text: Rich; muted?: boolean }
  | { t: "note"; tone: Tone; text: Rich }
  | { t: "meter"; label: string; used: number; total: number; unit: string; detail?: string }
  | { t: "stats"; items: { value: string; label: string }[] }
  | { t: "table"; caption?: string; rows: { label: string; value: string; tone?: Tone }[] }
  | { t: "steps"; title?: string; items: Rich[] }
  | { t: "h2"; text: string; count?: number }
  /** One-time code, shown large and spaced (auth emails). */
  | { t: "code"; code: string; label?: string }
  /** Fallback URL printed as text so it can be copied when the button fails. */
  | { t: "rawlink"; label: string; href: string }
  | { t: "list"; items: { text: Rich; meta?: string; tone?: Tone; link?: { label: string; href: string } }[] };

export type Cta = { label: string; href: string };

export type Audience = "owner" | "ops";

export type EmailSpec = {
  audience: Audience;
  /** Essential mail has no unsubscribe link or header. */
  essential: boolean;
  subject: string;
  preheader: string;
  heading: string;
  pill?: { tone: Tone; text: string };
  blocks: Block[];
  cta?: Cta;
  secondary?: Cta;
  /** One line in the footer saying why this person gets the email. */
  reason: string;
};

export function inlineText(r: Rich): string {
  const parts = Array.isArray(r) ? r : [r];
  return parts
    .map((p) => (typeof p === "string" ? p : "strong" in p ? p.strong : `${p.link} (${p.href})`))
    .join("");
}
