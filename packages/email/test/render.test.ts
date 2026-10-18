import { test } from "node:test";
import assert from "node:assert/strict";
import { renderEmail, catalog, followUps, deskRoutes } from "../src/index.ts";
import { fixtures } from "../src/fixtures.ts";

const BANNED_OWNER = /\b(wallet|top[ -]?up|prepaid|tenant|ledger|enforcement|units?|sautikit|textsms|soniox|gemini|resend|supabase|railway|vercel|on-demand)\b/i;
const DASHES = /[\u2013\u2014]/;
const UNSUB = "https://app.scalers.co.ke/unsubscribe?t=x";

const visible = (html: string) =>
  html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z#0-9]+;/gi, " ");

test("every kind has at least one fixture", () => {
  const covered = new Set(fixtures.map((f) => f.kind));
  for (const k of Object.keys(catalog)) assert.ok(covered.has(k as never), `no fixture for ${k}`);
});

for (const fx of fixtures) {
  test(`${fx.name}: renders html, text, preheader, one bulletproof CTA`, async () => {
    const e = await renderEmail(fx.kind, fx.props as never, { unsubscribeUrl: UNSUB });
    assert.ok(e.subject.length > 0 && e.subject.length <= 78, `subject length ${e.subject.length}`);
    assert.ok(e.preheader.length >= 20, "preheader too short");
    assert.ok(e.text.length > 80, "plain text missing");
    assert.match(e.html, /<v:roundrect[^>]+height:48px/, "VML button missing");
    assert.match(e.html, /xmlns:v="urn:schemas-microsoft-com:vml"/);
    assert.equal((e.html.match(/class="btn"/g) || []).length, 1, "exactly one primary button");
    assert.ok(!DASHES.test(visible(e.html)) && !DASHES.test(e.text) && !DASHES.test(e.subject), "em/en dash in copy");
    if (e.audience === "owner") {
      assert.ok(!BANNED_OWNER.test(visible(e.html)), `banned term in html: ${visible(e.html).match(BANNED_OWNER)?.[0]}`);
      // Route paths like /wallet are links, not copy.
      const textCopy = e.text.replace(/https?:\/\/\S+/g, "");
      assert.ok(!BANNED_OWNER.test(textCopy) && !BANNED_OWNER.test(e.subject), `banned term in text/subject: ${textCopy.match(BANNED_OWNER)?.[0]}`);
      assert.equal(e.from, "Scalers <hello@alerts.scalers.co.ke>");
      assert.equal(e.replyTo, "support@scalers.co.ke");
    } else {
      assert.equal(e.from, "Scalers ops <platform@ops.scalers.co.ke>");
      assert.ok(e.subject.startsWith("[Scalers ops]"));
    }
    if (e.essential) {
      assert.ok(!e.html.includes(UNSUB) && !e.headers["List-Unsubscribe"], "essential mail must not carry unsubscribe");
    } else {
      assert.ok(e.html.includes(UNSUB) && e.text.includes(UNSUB));
      assert.equal(e.headers["List-Unsubscribe-Post"], "List-Unsubscribe=One-Click");
    }
  });
}

test("owner mail in beta always says nothing is charged", async () => {
  for (const fx of fixtures) {
    const p = fx.props as { mode?: string };
    if (p.mode !== "beta") continue;
    const e = await renderEmail(fx.kind, fx.props as never);
    assert.match(e.text, /nothing (is|was) charged|Nothing \(free beta\)/i, `${fx.name} lacks the beta line`);
  }
});

test("live mode never mentions the beta", async () => {
  const e = await renderEmail("usage_100", { businessName: "B", mode: "live", resource: "texts", used: 200, included: 200, resetDate: "1 November", extraUsage: false });
  assert.ok(!/beta/i.test(e.text));
  assert.match(e.html, /Turn on extra usage/);
});

test("owner CTAs deep-link to real Desk routes; ops CTAs to Admin", async () => {
  const routes = Object.values(deskRoutes).map((r) => `https://app.scalers.co.ke${r}`);
  for (const fx of fixtures) {
    const e = await renderEmail(fx.kind, fx.props as never);
    const href = e.html.match(/<a href="([^"]+)" class="btn"/)?.[1]?.replace(/&amp;/g, "&");
    assert.ok(href, `${fx.name} has no CTA`);
    if (e.audience === "ops") assert.ok(href!.startsWith("https://admin.scalers.co.ke/admin/"), href);
    else if (fx.kind !== "invite_reminder") assert.ok(routes.includes(href!), `${fx.name}: ${href} is not a Desk route`);
  }
});

test("follow-ups are capped at 2 and say when they stop", () => {
  for (const [k, f] of Object.entries(followUps)) {
    assert.ok(f!.delays.length >= 1 && f!.delays.length <= 2, `${k} cap`);
    assert.ok(f!.stopWhen.length > 10, `${k} stop condition`);
  }
});
