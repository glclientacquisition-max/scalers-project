/**
 * "Set up your calls" (/onboarding/line): code builders, 07 formatting, ring time,
 * tel: encoding, Android-only dial, saved picks, and the Overview card rule.
 * Codes from the Ops research 18 Oct 2026 (kenya_call_forwarding_research.md).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register } from "node:module";
import { pathToFileURL } from "node:url";
import {
  ALL_OFF_CODE,
  CHECK_CODES,
  DEFAULT_RING,
  FORWARD_CHOICES,
  TESTED_NETWORKS,
  canTapToDial,
  dialHref,
  forwardOffCode,
  forwardOnCode,
  forwardsEveryCall,
  networkCodeNote,
  noAnswerFallbackCodes,
  phoneFromUserAgent,
  ringSeconds,
  telHref,
  toLocal07,
} from "../dashboard/src/lib/callForwarding.ts";

// callSetupStore imports "./callForwarding" without an extension.
register("./tsResolveHook.mjs", pathToFileURL("./tests/"));
const store = await import("../dashboard/src/lib/callSetupStore.ts");

const N = "0709000123";

describe("call forwarding codes", () => {
  it("formats the Scalers number as local 07 digits", () => {
    assert.equal(toLocal07("+254709000123"), N);
    assert.equal(toLocal07("+254 709 000 123"), N);
    assert.equal(toLocal07("254709000123"), N);
    assert.equal(toLocal07("0709 000 123"), N);
    assert.equal(toLocal07("709000123"), N);
    assert.equal(toLocal07("+254 711 082 000"), "0711082000");
    assert.equal(toLocal07("+254110000123"), "0110000123");
    assert.equal(toLocal07("pending:abc"), null);
    assert.equal(toLocal07(""), null);
    assert.equal(toLocal07(null), null);
    assert.equal(toLocal07("+15551234567"), null);
  });

  it("builds each turn-on code with the number and ring time (double star)", () => {
    assert.equal(forwardOnCode("all", N, 20), "**004*0709000123**20#");
    assert.equal(forwardOnCode("no_answer", N, 20), "**61*0709000123**20#");
    assert.equal(forwardOnCode("busy", N, 20), "**67*0709000123#");
    assert.equal(forwardOnCode("off", N, 20), "**62*0709000123#");
    assert.equal(forwardOnCode("all", N, 15), "**004*0709000123**15#");
    assert.equal(forwardOnCode("no_answer", N, 30), "**61*0709000123**30#");
    for (const choice of FORWARD_CHOICES) {
      assert.doesNotMatch(forwardOnCode(choice, N, 20), /\d\*20#$/, "single-star timer puts 20 in the service slot");
    }
  });

  it("each choice has its own turn-off code, and ##002# turns everything off", () => {
    assert.equal(forwardOffCode("all"), "##004#");
    assert.equal(forwardOffCode("no_answer"), "##61#");
    assert.equal(forwardOffCode("busy"), "##67#");
    assert.equal(forwardOffCode("off"), "##62#");
    assert.equal(ALL_OFF_CODE, "##002#");
    assert.deepEqual([...CHECK_CODES], ["*#61#", "*#67#", "*#62#"]);
  });

  it("ring time is 15, 20 or 30; anything else falls back to 20", () => {
    assert.equal(DEFAULT_RING, 20);
    assert.equal(ringSeconds(15), 15);
    assert.equal(ringSeconds("30"), 30);
    assert.equal(ringSeconds(45), 20);
    assert.equal(ringSeconds(5), 20);
    assert.equal(ringSeconds(undefined), 20);
    assert.equal(forwardOnCode("all", N, 45 as never), "**004*0709000123**20#");
  });

  it("fallbacks for no-answer: voice-only timer, then the network's own ring time", () => {
    assert.deepEqual(noAnswerFallbackCodes(N, 20), ["**61*0709000123*11*20#", "**61*0709000123#"]);
  });

  it("never builds a code that forwards every call", () => {
    assert.equal(forwardsEveryCall("**21*0709000123#"), true);
    assert.equal(forwardsEveryCall("**002*0709000123#"), true);
    assert.equal(forwardsEveryCall("*002*0709000123#"), true);
    assert.equal(forwardsEveryCall(ALL_OFF_CODE), false);
    const all = [
      ...FORWARD_CHOICES.flatMap((c) => [forwardOnCode(c, N, 20), forwardOffCode(c)]),
      ...noAnswerFallbackCodes(N, 20),
      ALL_OFF_CODE,
    ];
    for (const code of all) {
      assert.equal(forwardsEveryCall(code), false, code);
      assert.doesNotMatch(code, /\*\*21\*|\*\*002\*/);
    }
    assert.equal(dialHref("**21*0709000123#", "android"), null);
  });

  it("tel: links encode # as %23 and keep *", () => {
    assert.equal(telHref("**004*0709000123**20#"), "tel:**004*0709000123**20%23");
    assert.equal(telHref("##002#"), "tel:%23%23002%23");
    assert.equal(telHref("##61#"), "tel:%23%2361%23");
    assert.doesNotMatch(telHref(forwardOnCode("busy", N)), /#/);
  });

  it("network note: tested on Safaricom and Airtel, Telkom stays hedged", () => {
    assert.match(networkCodeNote("safaricom"), /^Tested on Safaricom\./);
    assert.match(networkCodeNote("airtel"), /^Tested on Airtel\./);
    assert.match(networkCodeNote("telkom"), /haven't tested Telkom yet/);
    assert.match(networkCodeNote(null), /Tested on Safaricom and Airtel.*haven't tested it yet/);
    assert.deepEqual([...TESTED_NETWORKS], ["safaricom", "airtel"]);
  });

  it("tap-to-dial shows on Android only (never iPhone, never before the phone is known)", () => {
    assert.equal(canTapToDial("android"), true);
    assert.equal(canTapToDial("iphone"), false);
    assert.equal(canTapToDial(null), false);
    assert.equal(dialHref("##002#", "android"), "tel:%23%23002%23");
    assert.equal(dialHref("##002#", "iphone"), null);
    assert.equal(dialHref("##002#", undefined), null);
    assert.equal(phoneFromUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Mobile/15E148"), "iphone");
    assert.equal(phoneFromUserAgent("Mozilla/5.0 (Linux; Android 14; TECNO KJ5) Mobile Safari/537.36"), "android");
  });
});

describe("saved picks and the Overview card", () => {
  function memory() {
    const map = new Map<string, string>();
    return { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v), map };
  }

  it("stores picks per tenant and reads them back clean", () => {
    const mem = memory();
    const s = store.localCallSetupStore(mem);
    assert.equal(s.load("t1").tested_at, null);
    s.save("t1", { ...store.emptyCallSetup(), option: "forward", network: "airtel", phone: "iphone", ring_seconds: 30 });
    assert.ok(mem.map.has("scalers.callSetup.v1.t1"));
    const back = s.load("t1");
    assert.equal(back.option, "forward");
    assert.equal(back.network, "airtel");
    assert.equal(back.ring_seconds, 30);
    assert.equal(s.load("t2").option, null, "another tenant on the same browser starts empty");
  });

  it("parses junk safely, keeps 'all' alone, and accepts a future DB row shape", () => {
    assert.deepEqual(store.parseCallSetup("{bad json").choices, ["all"]);
    assert.deepEqual(store.parseCallSetup({ choices: ["all", "busy"] }).choices, ["all"]);
    assert.deepEqual(store.parseCallSetup({ choices: ["busy", "busy", "nope"] }).choices, ["busy"]);
    assert.equal(store.parseCallSetup({ ring_seconds: 45 }).ring_seconds, 20);
    assert.equal(store.parseCallSetup({ tested_at: "not a date" }).tested_at, null);
    const row = { option: "main_number", network: "safaricom", phone: "android", choices: [], ring_seconds: 15, tested_at: "2026-10-18T09:00:00Z" };
    // v2 (account copy) adds how/when fields and stores times as full ISO UTC.
    assert.deepEqual(store.parseCallSetup(row), {
      ...store.emptyCallSetup(),
      ...row,
      choices: ["all"],
      tested_at: "2026-10-18T09:00:00.000Z",
      tested_via: "manual",
    });
  });

  it("shows 'Finish setting up your calls' once the number exists, until tested", () => {
    const empty = store.emptyCallSetup();
    assert.equal(store.showFinishCallsCard({ numberReady: false, setup: empty }), false);
    assert.equal(store.showFinishCallsCard({ numberReady: true, setup: null }), true);
    assert.equal(store.showFinishCallsCard({ numberReady: true, setup: empty }), true);
    assert.equal(store.showFinishCallsCard({ numberReady: true, setup: { ...empty, option: "forward" } }), true);
    assert.equal(store.showFinishCallsCard({ numberReady: true, setup: { ...empty, tested_at: "2026-10-18T09:00:00Z" } }), false);
  });

  it("test step mentions the red button only when busy forwarding is on", () => {
    assert.equal(store.testIncludesBusy(["all"]), true);
    assert.equal(store.testIncludesBusy(["busy"]), true);
    assert.equal(store.testIncludesBusy(["no_answer", "off"]), false);
  });

  it("wires the step and the card: hidden while pending, card on Overview", () => {
    const line = readFileSync("dashboard/src/app/onboarding/line/LineView.tsx", "utf8");
    assert.match(line, /const local = pending \? null : toLocal07\(raw\)/);
    assert.match(line, /\{local \? <CallSetupStep/);
    const home = readFileSync("dashboard/src/app/(desk)/home/page.tsx", "utf8") +
    // D2: usage, insights, call setup and checks stream from their own slots.
    "\n" + readFileSync("dashboard/src/components/home/HomeOverviewSlots.tsx", "utf8");
    assert.match(home, /const numberReady = toLocal07\(tenant\.sautikit_virtual_number\) !== null;/);
    assert.match(home, /<HomeCallSetupCard[\s\S]{0,120}?numberReady=\{numberReady\}/);
    const card = readFileSync("dashboard/src/components/HomeCallSetupCard.tsx", "utf8");
    assert.match(card, /href="\/onboarding\/line"/);
    assert.match(card, /Finish setting up your calls/);
  });

  it("screen copy: no live transfer promise, no jargon, no dashes, no vendor names", () => {
    const files = [
      "dashboard/src/app/onboarding/line/CallSetupStep.tsx",
      "dashboard/src/components/HomeCallSetupCard.tsx",
      "dashboard/src/components/CopyCode.tsx",
      "dashboard/src/lib/callForwarding.ts",
    ];
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      const strings = (src.match(/"[^"\n]{12,}"|`[^`\n]{12,}`|>[^<>{}\n]{12,}</g) || []).join("\n");
      assert.doesNotMatch(strings, /put (you|them) through now|transfer(red)? (you|the call)|connect(s|ed)? you live/i, f);
      assert.doesNotMatch(strings, /\bUSSD\b|\bGSM\b|\bMMI\b|conditional|divert|CFNR/i, f);
      assert.doesNotMatch(strings, /[\u2013\u2014]/, f);
      assert.doesNotMatch(strings, /sautikit|supabase|vercel|railway|twilio|africa'?s talking/i, f);
    }
    for (const f of files.slice(0, 3)) {
      const src = readFileSync(f, "utf8");
      assert.doesNotMatch(src, /<svg|text-\[\d|#[0-9a-fA-F]{6}\b/, `${f} kit only`);
      assert.doesNotMatch(src, /framer|motion\/react|gsap|lottie/i, `${f} motion library`);
      assert.doesNotMatch(src, /DeskDialog|role="dialog"/, `${f} no centred dialog`);
    }
    const step = readFileSync(files[0], "utf8");
    assert.match(step, /It can&apos;t put a caller through to you during the call/);
    // **004*N**20# tested on Safaricom and Airtel (Alvin, 18 Oct 2026). Telkom stays hedged.
    assert.doesNotMatch(step, /same codes work on all/i);
    assert.match(step, /\{networkCodeNote\(setup\.network\)\}/);
    // "Recommended" on the all-in-one card stays static (no network or phone condition).
    assert.match(step, /choice="all"[\s\S]{0,200}?recommended\s/);
    // Recommended code first; the three single choices sit under a plain disclosure.
    assert.ok(step.indexOf('choice="all"') < step.indexOf("SEPARATE_CHOICES.map"), "recommended card first");
    assert.match(step, /<details[^>]*>[\s\S]{0,600}?Other choices/);
    // Airtime reminder shows before the codes in the dial step.
    assert.ok(step.indexOf("Airtime first.") < step.indexOf('choice="all"'), "airtime before dialling");
  });
});
