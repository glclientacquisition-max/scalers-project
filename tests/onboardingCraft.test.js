const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

function read(rel) {
  return fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
}

const DIR = "dashboard/src/app/onboarding";
const files = [
  `${DIR}/SetupFlow.tsx`,
  `${DIR}/steps/BusinessStep.tsx`,
  `${DIR}/steps/CatalogueStep.tsx`,
  `${DIR}/steps/HoursStep.tsx`,
  `${DIR}/steps/VoiceStep.tsx`,
  `${DIR}/steps/FaqsStep.tsx`,
  `${DIR}/steps/AlertsStep.tsx`,
  `${DIR}/line/page.tsx`,
  `${DIR}/line/PendingNumber.tsx`,
  `${DIR}/ConfirmEmailScreen.tsx`,
  "dashboard/src/app/signup/SignupForm.tsx",
  "dashboard/src/app/login/page.tsx",
];

describe("onboarding craft", () => {
  const page = read(`${DIR}/page.tsx`);
  const flow = read(`${DIR}/SetupFlow.tsx`);
  const all = files.map((f) => [f, read(f)]);

  it("has no AI-slop copy or template chrome", () => {
    for (const [file, src] of all) {
      assert.doesNotMatch(src, /e\.g\./, file);
      assert.doesNotMatch(src, /\bBA\b|Opening your line|Answers you can confirm/, file);
      assert.doesNotMatch(src, /\b(seamless|effortless|supercharge|leverage|unlock|elevate)\b/i, file);
      assert.doesNotMatch(src, /\s·\s/, file);
      assert.doesNotMatch(src, /→/, file);
      assert.doesNotMatch(src, /uppercase tracking|tracking-widest/, file);
      assert.doesNotMatch(src, /window\.(confirm|alert)\(/, file);
    }
  });

  it("keeps state on the server, steps in the URL, and one primary action in a safe-area bar", () => {
    assert.match(flow, /saveSetupStepAction/);
    assert.match(flow, /searchParams\.set\("step"/);
    assert.match(flow, /popstate/);
    assert.match(flow, /safe-area-inset-bottom/);
    assert.doesNotMatch(flow, /localStorage/);
  });

  it("respects reduced motion and announces progress", () => {
    assert.match(flow, /prefers-reduced-motion/);
    assert.match(flow, /motion-safe:/);
    assert.match(flow, /role="progressbar"/);
    assert.match(flow, /tabIndex=\{-1\}/);
  });

  it("offers a muted Sign out exit and gates on email confirmation", () => {
    assert.match(page, /\/api\/logout/);
    assert.match(page, />\s*Sign out\s*</);
    assert.match(page, /ConfirmEmailScreen/);
  });
});
