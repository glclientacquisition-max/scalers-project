/**
 * Render every fixture to HTML + text, then screenshot desktop and mobile with
 * headless Chromium. Usage: npm run render [-- --out ./out --copy /workspace/scalers/email-previews]
 * Set CHROME_PATH to a Chrome/Chromium binary if Playwright's own browser isn't installed.
 */
import { mkdir, writeFile, copyFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright-core";
import { renderEmail } from "../src/index.ts";
import { fixtures } from "../src/fixtures.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const arg = (k: string) => {
  const i = process.argv.indexOf(k);
  return i > -1 ? process.argv[i + 1] : undefined;
};
const outDir = path.resolve(arg("--out") ?? path.join(here, "..", "out"));
const copyTo = arg("--copy");
const assets = pathToFileURL(path.resolve(here, "../../../dashboard/public")).href;

const DARK = new Set(["welcome", "usage-100"]);
const widths = { desktop: 680, mobile: 375 } as const;

async function main() {
  await mkdir(outDir, { recursive: true });
  const exe = process.env.CHROME_PATH ?? ["/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"].find(existsSync);
  const browser = await chromium.launch(exe ? { executablePath: exe } : {});
  const index: string[] = [];
  for (const fx of fixtures) {
    const email = await renderEmail(fx.kind, fx.props as never, { urls: { assets }, unsubscribeUrl: "https://app.scalers.co.ke/unsubscribe?t=sample" });
    const htmlPath = path.join(outDir, `${fx.name}.html`);
    await writeFile(htmlPath, email.html);
    await writeFile(path.join(outDir, `${fx.name}.txt`), `Subject: ${email.subject}\nPreheader: ${email.preheader}\nFrom: ${email.from}\n${email.replyTo ? `Reply-To: ${email.replyTo}\n` : ""}${Object.entries(email.headers).map(([k, v]) => `${k}: ${v}\n`).join("")}\n${email.text}`);
    const shots: [string, number, "light" | "dark"][] = [
      ["desktop", widths.desktop, "light"],
      ["mobile", widths.mobile, "light"],
    ];
    if (DARK.has(fx.name)) shots.push(["mobile-dark", widths.mobile, "dark"]);
    for (const [label, width, scheme] of shots) {
      const page = await browser.newPage({ viewport: { width, height: 200 }, deviceScaleFactor: 2, colorScheme: scheme });
      await page.goto(pathToFileURL(htmlPath).href);
      const png = path.join(outDir, `${fx.name}.${label}.png`);
      await page.screenshot({ path: png, fullPage: true });
      await page.close();
      if (copyTo) {
        await mkdir(copyTo, { recursive: true });
        await copyFile(png, path.join(copyTo, path.basename(png)));
      }
    }
    index.push(`${fx.name}\t${fx.kind}\t${email.subject}`);
  }
  await browser.close();
  await writeFile(path.join(outDir, "index.tsv"), index.join("\n") + "\n");
  console.log(`Rendered ${fixtures.length} emails to ${outDir}${copyTo ? `, PNGs copied to ${copyTo}` : ""}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
