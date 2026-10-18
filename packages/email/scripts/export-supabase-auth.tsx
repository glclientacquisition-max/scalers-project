/**
 * Export the Supabase Auth templates as static HTML (Go-template variables left in place)
 * into packages/email/supabase-auth/, then render previews with sample values.
 *
 *   npm run export:auth                                  # files + previews in out/
 *   npm run export:auth -- --copy /workspace/scalers/email-previews
 *   npm run export:auth -- --no-previews                 # files only (no Chrome needed)
 *
 * Previews swap the variables for sample values; the exported files never change for previews.
 */
import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { AUTH_KINDS, AUTH_TEMPLATES, renderAuthTemplate } from "../src/supabase-auth.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const arg = (k: string) => {
  const i = process.argv.indexOf(k);
  return i > -1 ? process.argv[i + 1] : undefined;
};
const exportDir = path.resolve(here, "..", "supabase-auth");
const outDir = path.resolve(arg("--out") ?? path.join(here, "..", "out"));
const copyTo = arg("--copy");
const previews = !process.argv.includes("--no-previews");

/** Sample values for previews only. Made up. */
export const SAMPLE: Record<string, string> = {
  "{{ .ConfirmationURL }}": "https://fjxcdccgyhnvnnlnovcl.supabase.co/auth/v1/verify?token=pkce_3f9a2c71e0&type=TYPE&redirect_to=https://app.scalers.co.ke/auth/callback",
  "{{ .Token }}": "482913",
  "{{ .Email }}": "wanjiru@kamauplumbing.co.ke",
  "{{ .NewEmail }}": "office@kamauplumbing.co.ke",
  "{{ .SiteURL }}": "https://app.scalers.co.ke",
};
const TYPE: Record<string, string> = { confirmation: "signup", invite: "invite", magic_link: "magiclink", recovery: "recovery", email_change: "email_change", reauthentication: "reauthentication" };
const fill = (s: string, kind: string) =>
  Object.entries(SAMPLE).reduce((acc, [k, v]) => acc.split(k).join(v.replace("TYPE", TYPE[kind]).replace(/&/g, "&amp;")), s);

async function main() {
  await mkdir(exportDir, { recursive: true });
  const subjects: Record<string, { dashboard: string; subject: string; apiSubject: string; apiContent: string; file: string }> = {};
  for (const kind of AUTH_KINDS) {
    const t = await renderAuthTemplate(kind);
    const meta = AUTH_TEMPLATES[kind];
    await writeFile(path.join(exportDir, `${meta.file}.html`), t.html);
    await writeFile(path.join(exportDir, `${meta.file}.txt`), `Subject: ${t.subject}\nPreheader: ${t.preheader}\n\n${t.text}`);
    subjects[kind] = { dashboard: meta.dashboard, subject: t.subject, apiSubject: meta.apiSubject, apiContent: meta.apiContent, file: `${meta.file}.html` };
  }
  await writeFile(path.join(exportDir, "subjects.json"), JSON.stringify(subjects, null, 2) + "\n");
  console.log(`Exported ${AUTH_KINDS.length} Supabase auth templates to ${exportDir}`);
  if (!previews) return;

  const { chromium } = await import("playwright-core");
  const assets = pathToFileURL(path.resolve(here, "../../../dashboard/public")).href;
  const exe = process.env.CHROME_PATH ?? ["/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"].find(existsSync);
  const browser = await chromium.launch(exe ? { executablePath: exe } : {});
  await mkdir(outDir, { recursive: true });
  for (const kind of AUTH_KINDS) {
    const t = await renderAuthTemplate(kind, { assets });
    const name = `auth-${AUTH_TEMPLATES[kind].file}`;
    const htmlPath = path.join(outDir, `${name}.html`);
    await writeFile(htmlPath, fill(t.html, kind));
    const shots: [string, number, "light" | "dark"][] = [["desktop", 680, "light"], ["mobile", 375, "light"]];
    if (kind === "recovery") shots.push(["mobile-dark", 375, "dark"]);
    for (const [label, width, scheme] of shots) {
      const page = await browser.newPage({ viewport: { width, height: 200 }, deviceScaleFactor: 2, colorScheme: scheme });
      await page.goto(pathToFileURL(htmlPath).href);
      const png = path.join(outDir, `${name}.${label}.png`);
      await page.screenshot({ path: png, fullPage: true });
      await page.close();
      if (copyTo) {
        await mkdir(copyTo, { recursive: true });
        await copyFile(png, path.join(copyTo, path.basename(png)));
      }
    }
  }
  await browser.close();
  console.log(`Previews in ${outDir}${copyTo ? `, PNGs copied to ${copyTo}` : ""}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
