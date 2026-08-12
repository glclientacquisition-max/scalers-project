import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { normalizeVoicePublicBase } = require("../dashboard/src/lib/voicePublicBase.js");

describe("normalizeVoicePublicBase", () => {
  it("defaults when empty", () => {
    assert.equal(
      normalizeVoicePublicBase(""),
      "https://scalers-project-production.up.railway.app"
    );
  });

  it("adds https when host-only (Vercel paste mistake)", () => {
    assert.equal(
      normalizeVoicePublicBase("scalers-project-production.up.railway.app"),
      "https://scalers-project-production.up.railway.app"
    );
    assert.equal(
      normalizeVoicePublicBase("scalers-project-production.up.railway.app/"),
      "https://scalers-project-production.up.railway.app"
    );
  });

  it("keeps explicit https and strips path/trailing slash", () => {
    assert.equal(
      normalizeVoicePublicBase(
        "https://scalers-project-production.up.railway.app/api/"
      ),
      "https://scalers-project-production.up.railway.app"
    );
  });

  it("strips accidental NAME=value paste", () => {
    assert.equal(
      normalizeVoicePublicBase(
        "VOICE_PUBLIC_BASE_URL=scalers-project-production.up.railway.app"
      ),
      "https://scalers-project-production.up.railway.app"
    );
  });
});
