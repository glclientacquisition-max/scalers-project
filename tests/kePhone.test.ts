import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { kePhoneDigits } from "../dashboard/src/lib/kePhone.ts";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

// Mirrors CallLink telHref / WhatsAppLink waMeHref (both are kePhoneDigits + prefix).
const tel = (n: string) => {
  const d = kePhoneDigits(n);
  return d ? `tel:+${d}` : null;
};
const wa = (n: string) => {
  const d = kePhoneDigits(n);
  return d ? `https://wa.me/${d}` : null;
};

describe("kePhoneDigits: Kenyan caller numbers", () => {
  const cases: Array<[string, string | null]> = [
    ["0712345678", "254712345678"],
    ["0110123456", "254110123456"],
    ["712345678", "254712345678"],
    ["+254712345678", "254712345678"],
    ["254712345678", "254712345678"],
    ["+254 712 345 678", "254712345678"],
    ["anonymous", null],
    ["", null],
  ];
  for (const [input, want] of cases) {
    it(`${JSON.stringify(input)} → ${want}`, () => {
      assert.equal(kePhoneDigits(input), want);
      assert.equal(tel(input), want ? `tel:+${want}` : null);
      assert.equal(wa(input), want ? `https://wa.me/${want}` : null);
    });
  }
  it("null and short numbers give no button", () => {
    assert.equal(kePhoneDigits(null), null);
    assert.equal(kePhoneDigits("12345"), null);
    assert.equal(kePhoneDigits("+0712345678"), "254712345678");
  });
});

describe("Inbox reach wiring", () => {
  const call = read("dashboard/src/components/CallLink.tsx");
  const link = read("dashboard/src/components/WhatsAppLink.tsx");
  const actions = read("dashboard/src/app/(desk)/calls/actions.ts");
  const row = read("dashboard/src/components/InboxItemRow.tsx");

  it("CallLink and WhatsAppLink both use kePhoneDigits", () => {
    assert.match(call, /kePhoneDigits\(rawNumber\)/);
    assert.match(link, /kePhoneDigits\(rawNumber\)/);
  });
  it("desktop Call copies the number; touch keeps tel:", () => {
    assert.match(call, /\(pointer: coarse\)/);
    assert.match(call, /Number copied/);
  });
  it("WhatsApp tap only logs the note, fire-and-forget", () => {
    assert.match(link, /sendBeacon/);
    assert.match(link, /keepalive: true/);
    assert.doesNotMatch(actions, /lead_status: "resolved",\s*resolution_note/);
    assert.match(actions, /update\(\{ resolution_note: note \}\)/);
  });
  it("list rows carry no Call or WhatsApp", () => {
    assert.doesNotMatch(row, /CallLink|WhatsAppLink|call_wa/);
  });
});
