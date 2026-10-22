import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

/**
 * require() for Voice modules (src/*.js) from the Desk server.
 *
 * On Vercel only files under dashboard/ ship, so `next build` first copies the
 * voice closure to dashboard/.voice (scripts/sync-voice-modules.cjs) and
 * next.config.ts traces it. Local dev without a sync falls back to the repo.
 * Paths are repo-relative ("./src/tenantProfile.js") either way.
 */
function voiceRoot(): string {
  const cwd = process.cwd();
  const candidates = [path.join(cwd, ".voice"), path.join(cwd, "dashboard", ".voice"), path.join(cwd, "..")];
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, "src", "tenantProfile.js"))) return dir;
  }
  return candidates[0];
}

let cached: NodeRequire | null = null;

export function requireVoice<T = unknown>(spec: string): T {
  if (!cached) cached = createRequire(path.join(voiceRoot(), "package.json"));
  return cached(spec) as T;
}
