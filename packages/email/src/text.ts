import { inlineText, type EmailSpec } from "./spec.ts";

/** Hand-shaped plain-text part from the same spec as the HTML, so copy can't drift. */
export function specToText(
  spec: EmailSpec,
  footer: { support: string; unsubscribeUrl?: string; alertsUrl?: string },
): string {
  const out: string[] = [];
  out.push(spec.pill ? `${spec.heading} [${spec.pill.text}]` : spec.heading, "");
  for (const b of spec.blocks) {
    switch (b.t) {
      case "p":
      case "note":
        out.push(inlineText(b.text), "");
        break;
      case "meter": {
        const pct = b.total > 0 ? Math.round((b.used / b.total) * 100) : 0;
        out.push(`${b.label}: ${b.used} of ${b.total} ${b.unit} (${pct}%)${b.detail ? `. ${b.detail}` : ""}`, "");
        break;
      }
      case "stats":
        for (const s of b.items) out.push(`${s.value}  ${s.label}`);
        out.push("");
        break;
      case "table":
        if (b.caption) out.push(b.caption);
        for (const r of b.rows) out.push(`${r.label}: ${r.value}`);
        out.push("");
        break;
      case "steps":
        if (b.title) out.push(b.title);
        b.items.forEach((s, i) => out.push(`${i + 1}. ${inlineText(s)}`));
        out.push("");
        break;
      case "h2":
        out.push(b.count != null ? `${b.text} (${b.count})` : b.text, "-".repeat(b.text.length));
        break;
      case "list":
        for (const it of b.items) out.push(`- ${inlineText(it.text)}${it.meta ? ` (${it.meta})` : ""}${it.link ? ` ${it.link.label}: ${it.link.href}` : ""}`);
        out.push("");
        break;
    }
  }
  if (spec.cta) out.push(`${spec.cta.label}: ${spec.cta.href}`);
  if (spec.secondary) out.push(`${spec.secondary.label}: ${spec.secondary.href}`);
  out.push("", "--", spec.reason);
  if (spec.audience === "owner") out.push(`Questions? Reply to this email or write to ${footer.support}.`);
  if (!spec.essential && footer.unsubscribeUrl) {
    out.push(`Unsubscribe: ${footer.unsubscribeUrl}`);
    if (footer.alertsUrl) out.push(`Choose which emails you get: ${footer.alertsUrl}`);
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}
