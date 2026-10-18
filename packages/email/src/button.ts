import { fontStack, layout, light } from "./tokens.ts";

export function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/**
 * Bulletproof primary button as raw HTML.
 * Outlook desktop (Word engine) gets a VML roundrect with a fixed size; every
 * other client gets a padded <a> with a 48px tap target (>= 44px).
 */
export function buttonHtml(label: string, href: string): string {
  const h = layout.buttonHeight;
  // Width estimate for VML only: ~9px per character at 16px semibold, plus padding.
  const w = Math.max(160, Math.round(label.length * 9.2 + 56));
  const l = esc(label);
  const u = esc(href);
  return [
    `<!--[if mso]>`,
    `<v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${u}" style="height:${h}px;v-text-anchor:middle;width:${w}px;" arcsize="17%" stroke="f" fillcolor="${light.accent}">`,
    `<w:anchorlock/><center style="color:${light.accentOn};font-family:'Segoe UI',Arial,sans-serif;font-size:16px;font-weight:600;">${l}</center>`,
    `</v:roundrect>`,
    `<![endif]-->`,
    `<!--[if !mso]><!-- -->`,
    `<a href="${u}" class="btn" target="_blank" style="display:inline-block;background-color:${light.accent};color:${light.accentOn};font-family:${esc(fontStack)};font-size:16px;font-weight:600;line-height:20px;text-decoration:none;text-align:center;padding:14px 28px;border-radius:8px;mso-hide:all;min-width:120px;">${l}</a>`,
    `<!--<![endif]-->`,
  ].join("");
}
