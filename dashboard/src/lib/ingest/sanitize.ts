/** Turn messy HTML / page text into clean plain text for the extractor. */

const MAX_CHARS = 40_000;

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => {
      const code = Number(n);
      return Number.isFinite(code) ? String.fromCharCode(code) : "";
    });
}

function metaContents(html: string): string[] {
  const out: string[] = [];
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  if (title) out.push(decodeEntities(title.replace(/<[^>]+>/g, " ").trim()));

  const metaRe =
    /<meta\b([^>]*?)\/?>/gi;
  let m: RegExpExecArray | null;
  while ((m = metaRe.exec(html))) {
    const attrs = m[1] || "";
    const name =
      attrs.match(/\b(?:name|property)\s*=\s*["']([^"']+)["']/i)?.[1] || "";
    const content =
      attrs.match(/\bcontent\s*=\s*["']([^"']*)["']/i)?.[1] || "";
    const key = name.toLowerCase();
    if (
      content &&
      (key === "description" ||
        key === "keywords" ||
        key === "title" ||
        key === "og:description" ||
        key === "og:title" ||
        key === "twitter:description" ||
        key === "twitter:title")
    ) {
      out.push(decodeEntities(content.trim()));
    }
  }
  return out.filter(Boolean);
}

function jsonLdText(html: string): string {
  const chunks: string[] = [];
  const re =
    /<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const raw = (m[1] || "").trim();
    if (!raw) continue;
    try {
      const walk = (node: unknown, depth = 0) => {
        if (depth > 8 || node == null) return;
        if (typeof node === "string") {
          const t = node.trim();
          if (t.length >= 3 && t.length <= 400) chunks.push(t);
          return;
        }
        if (Array.isArray(node)) {
          for (const x of node) walk(x, depth + 1);
          return;
        }
        if (typeof node === "object") {
          const obj = node as Record<string, unknown>;
          for (const key of [
            "name",
            "description",
            "slogan",
            "text",
            "category",
            "brand",
          ]) {
            if (typeof obj[key] === "string") walk(obj[key], depth + 1);
          }
          if (obj["@graph"]) walk(obj["@graph"], depth + 1);
          if (obj.offers) walk(obj.offers, depth + 1);
          if (obj.itemListElement) walk(obj.itemListElement, depth + 1);
          if (obj.makesOffer) walk(obj.makesOffer, depth + 1);
        }
      };
      walk(JSON.parse(raw));
    } catch {
      // ignore bad JSON-LD
    }
  }
  return chunks.join("\n");
}

/** True when the HTML is mostly a client-rendered shell with little body copy. */
export function looksLikeClientRenderedShell(html: string): boolean {
  const body = html.match(/<body\b[^>]*>([\s\S]*)<\/body>/i)?.[1] || html;
  const withoutScripts = body
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ");
  const visible = withoutScripts
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const emptyRoot =
    /<div\s+id=["'](?:root|app|__next)["']\s*>\s*<\/div>/i.test(html) ||
    /<div\s+id=["'](?:root|app|__next)["']\s*\/>/i.test(html);
  return emptyRoot || visible.length < 80;
}

export function htmlToPlainText(raw: string): string {
  let s = String(raw || "");

  const headBits = [...metaContents(s), jsonLdText(s)].filter(Boolean);
  const headBlock = headBits.length
    ? `${Array.from(new Set(headBits)).join("\n")}\n\n`
    : "";

  // Drop scripts/styles/noscript early (JSON-LD already harvested)
  s = s.replace(/<script[\s\S]*?<\/script>/gi, " ");
  s = s.replace(/<style[\s\S]*?<\/style>/gi, " ");
  s = s.replace(/<noscript[\s\S]*?<\/noscript>/gi, " ");
  s = s.replace(/<!--[\s\S]*?-->/g, " ");

  // Line breaks for common block tags
  s = s.replace(/<\/(p|div|li|tr|h[1-6]|br|hr)>/gi, "\n");
  s = s.replace(/<(br|hr)\s*\/?>/gi, "\n");
  s = s.replace(/<\/?(ul|ol|table|section|article|header|footer)>/gi, "\n");

  // Strip remaining tags
  s = s.replace(/<[^>]+>/g, " ");

  s = decodeEntities(s);

  // Collapse whitespace
  s = s
    .replace(/\r/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();

  s = `${headBlock}${s}`.trim();

  if (s.length > MAX_CHARS) {
    s = `${s.slice(0, MAX_CHARS)}\n\n[truncated]`;
  }
  return s;
}

export function normalizePasteText(raw: string): string {
  const s = String(raw || "")
    .replace(/\r/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (s.length > MAX_CHARS) {
    return `${s.slice(0, MAX_CHARS)}\n\n[truncated]`;
  }
  return s;
}
