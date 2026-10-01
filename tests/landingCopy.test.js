const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

function read(rel) {
  return fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
}

function landingSource() {
  const dir = path.join(__dirname, "..", "dashboard/src/components/landing");
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith(".tsx"))
    .map((name) => fs.readFileSync(path.join(dir, name), "utf8"))
    .join("\n");
}

describe("marketing landing honesty", () => {
  const source = landingSource();

  it("repeats one beta CTA and a quiet how-it-works link", () => {
    const uses = source.match(/<LandingCta\b/g) || [];
    assert.ok(uses.length >= 3 && uses.length <= 5, `CTA count ${uses.length}`);
    assert.match(read("dashboard/src/components/landing/LandingCta.tsx"), /Request beta access/);
    assert.match(source, /See how it works/);
    assert.match(source, /Private beta\. Invite only\./);
    assert.match(source, /https:\/\/scalers\.co\.ke/);
  });

  it("fails closed on fake proof, prices, and unshipped claims", () => {
    assert.doesNotMatch(source, /Get [Ss]tarted|Open Desk|Start free trial|Book a walkthrough/);
    assert.doesNotMatch(source, /vercel\.app/i);
    assert.doesNotMatch(source, /AI-powered|trusted by|logo wall/i);
    assert.doesNotMatch(source, /KES\s|≥\s*90|90%|live transfer|M-Pesa|Mpesa|multi-agent/i);
    assert.doesNotMatch(source, /PackagePrices|id="packages"/);
    assert.doesNotMatch(source, /[—–]/);
  });

  it("keeps the section order and one product mock", () => {
    const page = read("dashboard/src/components/landing/LandingPage.tsx");
    const order = ["<LandingHero", "<Problem", "<HowItWorks", "<Outcomes", "<Proof", "<Faq", "<LandingClose"];
    let at = -1;
    for (const name of order) {
      const next = page.indexOf(name);
      assert.ok(next > at, name);
      at = next;
    }
    assert.match(page, /<main id="main">/);
    assert.match(source, /id="how"/);
    assert.match(source, /id="desk"/);
  });
});
