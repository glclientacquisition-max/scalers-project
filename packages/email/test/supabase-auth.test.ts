import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AUTH_KINDS, AUTH_TEMPLATES, SECURITY_LINE, renderAuthTemplate } from "../src/supabase-auth.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const DASHES = /[\u2013\u2014]/;
const BANNED = /\b(wallet|top[ -]?up|prepaid|tenant|supabase|resend|vercel|railway|unsubscribe)\b/i;
const visible = (html: string) =>
  html.replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<[^>]+>/g, " ").replace(/&#x27;|&#39;/g, "'").replace(/&[a-z#0-9]+;/gi, " ");

for (const kind of AUTH_KINDS) {
  test(`supabase auth ${kind}: Go-template safe, branded, essential`, async () => {
    const t = await renderAuthTemplate(kind);
    assert.ok(!t.html.includes("<!--"), "Go html/template strips comments; template must not rely on them");
    assert.ok(!/<v:roundrect/.test(t.html), "no VML in Supabase templates");
    assert.ok(t.subject.length > 0 && t.subject.length <= 78);
    assert.ok(t.preheader.length >= 20);
    const copy = visible(t.html);
    assert.ok(copy.includes(SECURITY_LINE), "security line missing");
    assert.ok(!DASHES.test(copy) && !DASHES.test(t.subject) && !DASHES.test(t.text), "em/en dash in copy");
    assert.ok(!BANNED.test(copy) && !BANNED.test(t.subject), `banned term: ${copy.match(BANNED)?.[0]}`);
    assert.match(t.html, /https:\/\/app\.scalers\.co\.ke\/brand\/icon-mark\.png/, "wordmark icon missing");
    assert.ok(!/Reply to this email/.test(t.html + t.text), "no-reply sender must not invite replies");
    if (kind === "reauthentication") {
      assert.ok(t.html.includes("{{ .Token }}"), "code missing");
      assert.equal((t.html.match(/class="btn"/g) || []).length, 0);
    } else {
      assert.equal((t.html.match(/class="btn"/g) || []).length, 1, "exactly one primary button");
      assert.match(t.html, /<a href="\{\{ \.ConfirmationURL \}\}" class="btn"/, "button must use {{ .ConfirmationURL }}");
      assert.match(t.html, /bgcolor="#005ccc"/, "table-cell button colour for Outlook");
    }
    if (kind === "email_change") assert.ok(t.html.includes("{{ .NewEmail }}"));
    // Only variables Supabase provides.
    for (const m of t.html.matchAll(/\{\{\s*([^}]*)\}\}/g)) {
      assert.match(m[1].trim(), /^\.(ConfirmationURL|Token|TokenHash|SiteURL|RedirectTo|Email|NewEmail)$/, `unknown variable ${m[0]}`);
    }
  });

  test(`supabase auth ${kind}: committed export matches source`, async () => {
    const t = await renderAuthTemplate(kind);
    const file = await readFile(path.join(here, "..", "supabase-auth", `${AUTH_TEMPLATES[kind].file}.html`), "utf8");
    assert.equal(file, t.html, "run `npm run export:auth` and commit supabase-auth/");
  });
}
