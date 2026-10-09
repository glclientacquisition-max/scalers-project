// Offer speech act. A spoken line that offers to note something for the team
// is the pending ask. English, Kiswahili, and Sheng share this act.
// A booking slot and a name ask are not offers, so Yes after those stays
// a slot answer. The packet and the mouth both read this act.

const IDENTITY_ASK =
  /\bam i speaking with\b|\b(?:je,?\s*)?(?:naongea na|unaongea na)\b|\b(?:your name|jina lako)\b/i;

const BOOKING_SLOT =
  /\b(?:which (?:service|one)(?: do you need)?|when would you like|would you like to book|do you want to book|tuje lini|huduma gani|siku gani|saa ngapi)\b/i;

const NOTE_ACT =
  /\b(?:note (?:this|that|it)(?: for the team)?|should i note|leave a message|log a callback|take a message)\b|\b(?:kukuachia ujumbe|ujumbe kwa timu|kuandika (?:hii )?kwa timu|andika hii kwa (?:timu|team))\b/i;

/**
 * @param {string} line
 * @returns {{ kind: 'offer', act: 'note_team' } | null}
 */
function offerActOf(line) {
  const raw = String(line || '').trim();
  if (!raw || IDENTITY_ASK.test(raw) || BOOKING_SLOT.test(raw)) return null;
  if (!NOTE_ACT.test(raw)) return null;
  return { kind: 'offer', act: 'note_team' };
}

module.exports = {
  offerActOf,
};
