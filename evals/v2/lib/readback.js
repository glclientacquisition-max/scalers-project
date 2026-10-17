'use strict';
// Read-back question cues shared by the scripted persona and the regression-9 write check.
// A read-back is the agent's confirm question before a commit write. Swahili "send to the team"
// verbs (nipeleke / tupeleke / nitume, #727 request read-back "…Nipeleke ombi hili kwa timu?")
// count only with a request/booking object, so an unrelated "nitume…" offer is not a read-back.
// "nikutumie" (I send YOU, e.g. an SMS/link) is deliberately excluded: it offers to message the
// caller, it does not confirm a write.
const EN = /\b(shall i|should i|go ahead|confirm|book it|place the order|send (this|the|your) (request|booking|order))\b/i;
const SW = /\b(nithibitishe|niendelee|niweke|tuweke)\b|\b(nipeleke|tupeleke|nitume)\s+(ombi|oda|order|booking|maombi|hili|hii|hiyo)\b/i;
function isReadbackQuestion(line) {
  const s = String(line || '');
  return /\?\s*$/.test(s) && (EN.test(s) || SW.test(s));
}
module.exports = { isReadbackQuestion, READBACK_EN: EN, READBACK_SW: SW };
