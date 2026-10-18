// The lead reason is the caller's need, not the name detour (HD_cd0c01f28b05).
//
// Staging call HD_cd0c01f28b05: the caller asked the time. The stored-name check
// turned into three turns of spelling, and the model's save_caller_info carried
// reason "correct name spelling". That reason was saved on the call and went
// out in the owner's lead email as "Reason: correct name spelling".
//
// A reason that only talks about the caller's name, its spelling, or who is
// speaking is not a reason for calling. It is never saved, and the lead falls
// back to the need Brain recorded ("Alvin asked about what time it is.").

const NAME_META = new Set([
  // the name itself
  'name', 'names', "name's", 'jina', 'majina', 'surname', 'firstname',
  // spelling / correcting / confirming it
  'spell', 'spelling', 'spelled', 'spelt', 'spells', 'correct', 'correction', 'corrected', 'correcting',
  'confirm', 'confirmed', 'confirming', 'confirmation', 'clarify', 'clarified', 'clarifying', 'clarification',
  'verify', 'verified', 'verifying', 'verification', 'update', 'updated', 'updating', 'fix', 'fixed',
  'identity', 'identify', 'identified', 'identification', 'introduced', 'introduction', 'gave', 'given', 'give',
  'provided', 'provide', 'shared', 'said', 'stated', 'told', 'repeat', 'repeated', 'mispronounced', 'misheard',
  'sahihi', 'kusahihisha', 'kurekebisha', 'kuthibitisha', 'thibitisha', 'tahajia',
  // who
  'caller', "caller's", 'callers', 'customer', "customer's", 'client', 'speaker', 'person', 'who', 'speaking',
  // glue
  'the', 'a', 'an', 'of', 'to', 'and', 'for', 'is', 'was', 'his', 'her', 'their', 'my', 'your', 'its', 'on', 'in',
  'as', 'with', 'by', 'from', 'about', 'la', 'ya', 'wa', 'na', 'kwa', 'yake', 'lake', 'langu', 'lako', 'only', 'just',
]);

/** True when the reason is only about the caller's name, its spelling, or who is speaking. */
function isNameDetourReason(reason) {
  const raw = String(reason || '').toLowerCase().trim();
  if (!raw) return false;
  if (!/\b(name|names|jina|majina|spell\w*|identity)\b/.test(raw)) return false;
  const words = raw
    .replace(/[“”"()]/g, ' ')
    .split(/[^a-z0-9'’]+/i)
    .map((w) => w.replace(/’/g, "'"))
    .filter(Boolean);
  // A spelled-out name ("A-L-V-I-N") and the name itself are not a need either.
  const content = words.filter(
    (w) => !NAME_META.has(w) && !/^[a-z]$/.test(w) && !/^\d+$/.test(w)
  );
  return content.length <= 1 && words.length <= 12 && !/\b(book|visit|price|clean|order|hold|deliver|time|hours|open|close)\w*/.test(raw);
}

/** A reason worth putting on a lead: present and not the name detour. */
function usableLeadReason(reason) {
  const raw = String(reason || '').replace(/\s+/g, ' ').trim();
  if (!raw || isNameDetourReason(raw)) return '';
  return raw;
}

module.exports = {
  isNameDetourReason,
  usableLeadReason,
};
