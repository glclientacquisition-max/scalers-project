import { beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import type { CallMessage } from "../dashboard/src/lib/callMessages.ts";
import { composerLabel, textThreadBubbles } from "../dashboard/src/lib/callTextThread.ts";
import {
  addPendingText,
  dropPendingTexts,
  mergePendingTexts,
  pendingTextBubble,
  pendingTextsFor,
  resetPendingTexts,
  settlePendingText,
  subscribePendingTexts,
} from "../dashboard/src/lib/pendingTexts.ts";

const root = path.join(import.meta.dirname, "..");
const read = (rel: string) => fs.readFileSync(path.join(root, rel), "utf8");
const T0 = Date.parse("2026-10-28T07:00:00.000Z");

function out(id: string, body: string, at: number, status: CallMessage["status"] = "sent"): CallMessage {
  return {
    id,
    createdAt: new Date(at).toISOString(),
    direction: "out",
    body,
    status,
    failureReason: status === "failed" ? "textsms_500" : null,
    retryOf: null,
    authorKind: "owner",
    source: "caller_inbox_reply",
    sentAt: null,
  };
}

const base = { callId: "call-1", callerPhone: "254700000001" };

describe("pending text bubbles (D3)", () => {
  beforeEach(() => resetPendingTexts());

  it("shows a Sending bubble the moment Send is tapped", () => {
    addPendingText({ ...base, id: "r1", body: "On my way", at: T0 });
    const [p] = pendingTextsFor("call-1");
    const b = pendingTextBubble(p);
    assert.equal(b.statusLabel, "Sending");
    assert.equal(b.ticks, 0);
    assert.equal(b.failed, false);
    assert.equal(b.side, "right");
  });

  it("flips to Sent with one tick, never Delivered", () => {
    addPendingText({ ...base, id: "r1", body: "On my way", at: T0 });
    settlePendingText("r1", { state: "sent" });
    const b = pendingTextBubble(pendingTextsFor("call-1")[0]);
    assert.equal(b.statusLabel, "Sent");
    assert.equal(b.ticks, 1);
    assert.notEqual(b.statusLabel, "Delivered");
  });

  it("flips to Not sent with the reason and Retry on failure", () => {
    addPendingText({ ...base, id: "r1", body: "On my way", at: T0 });
    settlePendingText("r1", { state: "failed", reason: "Check your connection." });
    const b = pendingTextBubble(pendingTextsFor("call-1")[0]);
    assert.equal(b.failed, true);
    assert.equal(b.statusLabel, "Not sent");
    assert.equal(b.reason, "Check your connection.");
    assert.equal(b.canRetry, true);
  });

  it("retry under the same reply id goes back to Sending", () => {
    addPendingText({ ...base, id: "r1", body: "On my way", at: T0 });
    settlePendingText("r1", { state: "failed", reason: "x" });
    addPendingText({ ...base, id: "r1", body: "On my way", at: T0 + 5000 });
    const list = pendingTextsFor("call-1");
    assert.equal(list.length, 1);
    assert.equal(list[0].state, "sending");
  });

  it("the server row replaces the local bubble (one to one)", () => {
    addPendingText({ ...base, id: "r1", body: "On my way", at: T0 });
    addPendingText({ ...base, id: "r2", body: "On my way", at: T0 + 1000 });
    const messages = [out("m1", "On my way ", T0 + 800)];
    const { bubbles, matched } = mergePendingTexts(messages, textThreadBubbles(messages), pendingTextsFor("call-1"));
    assert.deepEqual(matched, ["r1"]);
    assert.equal(bubbles.length, 2);
    assert.equal(bubbles[0].id, "m1");
    assert.equal(bubbles[1].id, "local:r2");
  });

  it("a server failed row also replaces it (its own Retry takes over)", () => {
    addPendingText({ ...base, id: "r1", body: "Tuesday 2pm", at: T0 });
    settlePendingText("r1", { state: "failed", reason: "Text service error." });
    const messages = [out("m1", "Tuesday 2pm", T0 + 500, "failed")];
    const { bubbles, matched } = mergePendingTexts(messages, textThreadBubbles(messages), pendingTextsFor("call-1"));
    assert.deepEqual(matched, ["r1"]);
    assert.equal(bubbles.length, 1);
    assert.equal(bubbles[0].statusLabel, "Not delivered");
  });

  it("does not match an old text with the same words", () => {
    addPendingText({ ...base, id: "r1", body: "Thanks", at: T0 });
    const messages = [out("m0", "Thanks", T0 - 60 * 60 * 1000)];
    const { matched, bubbles } = mergePendingTexts(messages, textThreadBubbles(messages), pendingTextsFor("call-1"));
    assert.deepEqual(matched, []);
    assert.equal(bubbles.at(-1)?.id, "local:r1");
  });

  it("store keeps calls apart, gives stable snapshots and notifies", () => {
    let calls = 0;
    const off = subscribePendingTexts(() => calls++);
    addPendingText({ ...base, id: "r1", body: "a", at: T0 });
    addPendingText({ callId: "call-2", callerPhone: "254700000002", id: "r2", body: "b", at: T0 });
    assert.equal(pendingTextsFor("call-1").length, 1);
    assert.equal(pendingTextsFor("call-1"), pendingTextsFor("call-1"));
    dropPendingTexts(["r1"]);
    assert.equal(pendingTextsFor("call-1").length, 0);
    assert.equal(pendingTextsFor("call-2").length, 1);
    off();
    assert.equal(calls, 3);
  });
});

describe("composer label and wiring (D3)", () => {
  it("names the text box for screen readers", () => {
    assert.equal(composerLabel("Chris Otieno"), "Text message to Chris");
    assert.equal(composerLabel(null), "Text message to caller");
    const dock = read("dashboard/src/components/InboxSmsDock.tsx");
    assert.match(dock, /htmlFor="inbox-sms"[\s\S]{0,40}composerLabel\(callerName\)/);
    const note = read("dashboard/src/components/CallerNoteComposer.tsx");
    assert.match(note, /htmlFor=\{`caller-note-\$\{callId\}`\}/);
    assert.match(note, /id=\{`caller-note-\$\{callId\}`\}/);
  });

  it("dock adds the Sending bubble before the server call and keeps its role gate", () => {
    const dock = read("dashboard/src/components/InboxSmsDock.tsx");
    const send = dock.slice(dock.indexOf("function send()"));
    assert.ok(send.indexOf("addPendingText(") < send.indexOf("deliverPendingText("));
    assert.match(dock, /withRoleGate\("inbox\.act", InboxSmsDockInner\)/);
    const deliver = read("dashboard/src/lib/pendingTextSend.ts");
    assert.match(deliver, /sendInboxReplySms\(\{\}, fd\)/);
    assert.match(deliver, /state: "failed"/);
  });

  it("thread renders local bubbles, says Not sent for them and keeps Retry behind canAct", () => {
    const thread = read("dashboard/src/components/CallTextThread.tsx");
    assert.match(thread, /mergePendingTexts\(messages, textThreadBubbles\(messages\), pending\)/);
    assert.match(thread, /local \? "Not sent\." : "Not delivered\."/);
    assert.match(thread, /b\.failed && b\.canRetry && canAct/);
    assert.doesNotMatch(read("dashboard/src/lib/pendingTexts.ts"), /statusLabel:[^\n]*Delivered/);
  });

  it("server action still checks membership", () => {
    assert.match(read("dashboard/src/app/(desk)/calls/noteActions.ts"), /memberDenied\(/);
  });
});
