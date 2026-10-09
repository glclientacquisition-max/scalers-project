'use strict';

/**
 * Read-time guard for saved alternate names (contact.metadata.alternate_names).
 * Older rows hold phrases the name extractor mistook for names ("impressed by
 * your", "not a", "so disappointed", "Mteja"). Those must never reach the
 * caller card, the shared-line check, or the STT hint list. Real names and
 * phrases that hold a name ("Bwana Alvin", "Alvin speaking", "Mama Amina")
 * stay.
 *
 * Rules (each is a class, not a list of seen strings):
 *  - junk / function words only (callerNameQuality);
 *  - role or address words only: mteja, customer, client, boss, madam, sir,
 *    dada, rafiki ... ("Mteja", "the client", "boss lady");
 *  - a feeling or state phrase: a feeling/state word (disappointed,
 *    nimechoka ...), an intensifier in front of a word ("so ...", "very ...",
 *    "... sana"), or a Kiswahili inflected verb (nime-, sija-, nina- ...);
 *  - a fragment that is a strict prefix of the primary on-file name ("Chr"
 *    for Chris), when the primary name is known.
 */

const { isJunkCallerName, NAME_FUNCTION_WORDS } = require('./callerNameQuality');
const { isPlausibleCallerName } = require('./entityExtraction');

// Words for a role, a relation or a form of address. A name made only of
// these (and function words) is not a person's name.
const ROLE_WORDS = new Set([
  // English
  'customer', 'customers', 'client', 'clients', 'caller', 'boss', 'madam', 'madame', 'maam', "ma'am",
  'sir', 'mister', 'mr', 'mrs', 'ms', 'miss', 'dear', 'friend', 'buddy', 'mate', 'bro', 'brother',
  'sister', 'sis', 'auntie', 'aunty', 'aunt', 'uncle', 'owner', 'manager', 'landlord', 'landlady',
  'tenant', 'neighbour', 'neighbor', 'husband', 'wife', 'son', 'daughter', 'boy', 'girl', 'lady',
  'gentleman', 'man', 'woman', 'guy', 'member', 'staff', 'worker', 'driver', 'guard', 'watchman',
  'secretary', 'receptionist', 'family', 'doctor', 'dr', 'teacher', 'pastor', 'officer', 'agent',
  'user', 'buyer', 'person', 'someone', 'somebody', 'nobody', 'anyone',
  // Kiswahili / Sheng
  'mteja', 'wateja', 'mwenye', 'mwenyenyumba', 'mwenyeji', 'mkubwa', 'mdosi', 'dada', 'kaka',
  'ndugu', 'rafiki', 'mama', 'baba', 'bibi', 'babu', 'shosh', 'cucu', 'mzee', 'mume', 'mke',
  'msichana', 'kijana', 'mtoto', 'jirani', 'fundi', 'dereva', 'askari', 'mlinzi', 'mwalimu',
  'daktari', 'mchungaji', 'bwana', 'bi', 'mheshimiwa', 'mtu', 'boss', 'buda', 'msee', 'manze',
  'beste', 'mresh', 'chali', 'dem', 'mathe', 'fathe',
]);

// Feeling and state words: how the caller feels or is, never who they are.
const FEELING_WORDS = new Set([
  // Not 'happy', 'joy', 'grace' ...: also given names; "so happy" is still
  // caught by the intensifier rule.
  'disappointed', 'unhappy', 'sad', 'angry', 'upset', 'mad', 'impressed', 'satisfied',
  'dissatisfied', 'unsatisfied', 'tired', 'busy', 'glad', 'pleased', 'grateful', 'thankful',
  'confused', 'worried', 'frustrated', 'annoyed', 'excited', 'interested', 'ready', 'late',
  'available', 'sick', 'ill', 'fine', 'okay', 'good', 'bad', 'great', 'sorry', 'serious', 'sure',
  'hungry', 'scared', 'afraid', 'surprised', 'shocked', 'amazed', 'delighted', 'concerned',
  'disgusted', 'stressed', 'bored', 'lost', 'stuck', 'done', 'finished', 'waiting', 'calling',
  'asking', 'wondering', 'looking', 'checking', 'following', 'complaining',
  // Kiswahili / Sheng states
  // Not 'salama', 'furaha', 'baraka': also given names.
  'mgonjwa', 'mzima', 'poa', 'fiti', 'sawa', 'freshi', 'hasira', 'huzuni',
  'uchovu', 'busy', 'mbaya', 'mzuri', 'nzuri', 'vizuri', 'vibaya',
]);

// "so disappointed", "very happy", "really sorry" (in front of a word);
// "furaha sana", "mbaya kabisa" (after one).
const INTENSIFIERS_BEFORE = new Set([
  'so', 'very', 'really', 'too', 'quite', 'extremely', 'super', 'totally', 'completely', 'truly', 'kinda',
]);
const INTENSIFIERS_AFTER = new Set(['sana', 'kabisa', 'mno', 'zaidi']);

// Kiswahili feeling verbs, any subject/tense prefix: "nimechoka",
// "sijafurahi", "tumesikitika", "amekasirika". First-person perfect and
// negative forms (nime-, sija-) are never a name either. Names that start
// like a prefix (Anastasia, Amelia, Alicia, Nitasha) do not match.
const SW_FEELING_VERB =
  /^(?:ni|si|tu|hatu|u|ha|a|m|ham|wa|hawa)?(?:me|ja|na|li|ta|ku|ki)?(?:choka|furahi|kasirika|sikitika|boeka|boreka|umia|chukia|kwazika|shangaa|ridhika|hangaika|vunjika|lalamika|pendezwa|changanyikiwa|onewa|haribikiwa)\p{L}*$/u;
const SW_FIRST_PERSON_VERB = /^(?:nime|sija)\p{L}{3,}$/u;

function wordsOf(name) {
  return name
    .toLowerCase()
    .split(/\s+/)
    .map((w) => w.replace(/^[^\p{L}']+|[^\p{L}']+$/gu, ''))
    .filter(Boolean);
}

function isRoleOnly(words) {
  return words.length > 0 && words.every((w) => ROLE_WORDS.has(w) || NAME_FUNCTION_WORDS.has(w));
}

function isFeelingPhrase(words) {
  if (words.some((w) => FEELING_WORDS.has(w) || SW_FEELING_VERB.test(w) || SW_FIRST_PERSON_VERB.test(w))) return true;
  if (words.length < 2) return false;
  // An intensifier in front of another word, or "... sana" after one.
  if (words.slice(0, -1).some((w) => INTENSIFIERS_BEFORE.has(w))) return true;
  return words.slice(1).some((w) => INTENSIFIERS_AFTER.has(w));
}

function primaryNamesOf(opts) {
  if (!opts || typeof opts !== 'object' || Array.isArray(opts)) return [];
  const raw = Array.isArray(opts.primary) ? opts.primary : [opts.primary];
  return raw
    .map((v) => String(v || '').toLowerCase().replace(/\s+/g, ' ').trim())
    .filter((v) => v.length >= 2);
}

/** "Chr" for Chris: a cut-off fragment of the primary name, not another person. */
function isPrimaryNamePrefix(name, primaries) {
  const alt = name.toLowerCase().replace(/[^\p{L}' ]/gu, '').trim();
  if (!alt) return false;
  for (const primary of primaries) {
    const tokens = [primary, ...primary.split(' ')];
    for (const token of tokens) {
      if (token.length > alt.length && token.startsWith(alt)) return true;
    }
  }
  return false;
}

/**
 * @param {string|{name?: string}} value
 * @param {{ primary?: string|string[] }} [opts] the file owner's name; any
 *   other second argument (an Array#filter index) is ignored.
 */
function isSavedAlternateName(value, opts) {
  const name = String(typeof value === 'string' ? value : value?.name || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!name || isJunkCallerName(name)) return false;
  const words = wordsOf(name);
  if (!words.length || isRoleOnly(words) || isFeelingPhrase(words)) return false;
  if (isPrimaryNamePrefix(name, primaryNamesOf(opts))) return false;
  return isPlausibleCallerName(name);
}

module.exports = { isSavedAlternateName, ROLE_WORDS, FEELING_WORDS };
