/** Run: npx tsx --tsconfig dashboard/tsconfig.json --test tests/contactValidation.test.ts */
import assert from "node:assert/strict";
import { it } from "node:test";
import { validateAlertsSave, validatePublicContacts } from "../dashboard/src/lib/contactValidation.ts";

it("alert phone normalized to E.164; junk rejected", () => {
  const ok = validateAlertsSave({ phone: "0712 345 678", email: "", channels: { sms: true } });
  assert.deepEqual(ok, { ok: true, phone: "+254712345678", email: null, channels: { sms: true }, note: null });
  assert.equal(validateAlertsSave({ phone: "abc", email: "", channels: {} }).ok, false);
  assert.equal(validateAlertsSave({ phone: "12345", email: "", channels: {} }).ok, false);
});
it("email channel on with empty email is turned off with a note (owner decision)", () => {
  const r = validateAlertsSave({ phone: "0712345678", email: "", channels: { email: true, sms: true } });
  assert.ok(r.ok);
  if (r.ok) {
    assert.equal(r.channels.email, false);
    assert.equal(r.channels.sms, true);
    assert.match(String(r.note), /turned off Email alerts/);
  }
  const fine = validateAlertsSave({ phone: "0712345678", email: "a@b.co", channels: { email: true } });
  assert.ok(fine.ok && fine.channels.email === true && fine.note === null);
});
it("sms/whatsapp on with no phone are turned off with a note", () => {
  const r = validateAlertsSave({ phone: "", email: "a@b.co", channels: { whatsapp: true, sms: true, email: true } });
  assert.ok(r.ok);
  if (r.ok) {
    assert.equal(r.channels.whatsapp, false);
    assert.equal(r.channels.sms, false);
    assert.equal(r.channels.email, true);
    assert.match(String(r.note), /SMS and WhatsApp alerts \(no alert phone\)/);
  }
});
it("public contacts: phones become E.164, junk and bad email rejected", () => {
  const r = validatePublicContacts({ channels: [{ kind: "whatsapp", label: "WhatsApp", value: "0740 000 000" }, { kind: "website", label: "Web", value: "aris.co.ke" }] } as never);
  assert.ok(r.ok);
  if (r.ok) assert.equal(r.handles.channels[0].value, "+254740000000");
  assert.equal(validatePublicContacts({ channels: [{ kind: "phone", label: "Phone", value: "abc" }] } as never).ok, false);
  assert.equal(validatePublicContacts({ channels: [{ kind: "email", label: "Email", value: "x@" }] } as never).ok, false);
});
