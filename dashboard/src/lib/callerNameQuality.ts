/**
 * Keep in lockstep with src/conversation/callerNameQuality.js
 * Names that must never be stored as the caller or shown on SMS.
 */

export const JUNK_CALLER_NAMES = new Set([
  "calling",
  "callings",
  "haijawekwa",
  "caller",
  "customer",
  "client",
  "guest",
  "unknown",
  "test",
  "testing",
  "user",
  "theexact",
  "the exact",
  "or the",
  "n/a",
  "na",
  "none",
  "receptionist",
  "agent",
  "assistant",
  "ai",
  "bot",
  "ataround",
  "at around",
]);

// Words that are never a name on their own (EN, Kiswahili, Sheng). A "name"
// made only of these is speech-to-text debris such as "not a".
export const NAME_FUNCTION_WORDS = new Set([
  // English function words
  'a', 'an', 'the', 'not', 'no', 'nor', 'or', 'and', 'but', 'so', 'if', 'then',
  'of', 'to', 'for', 'in', 'on', 'at', 'by', 'with', 'from', 'as', 'into', 'about',
  'is', 'am', 'are', 'was', 'were', 'be', 'been', 'it', 'its', "it's", 'this', 'that',
  'these', 'those', 'there', 'here', 'i', "i'm", 'im', 'me', 'my', 'mine', 'you',
  'your', 'we', 'our', 'he', 'she', 'his', 'her', 'they', 'them', 'their', 'do',
  'does', 'did', "don't", 'dont', 'can', 'just', 'also', 'too', 'very',
  'what', 'where', 'when', 'who', 'how', 'why', 'which', 'name', 'called', 'speaking',
  'speak', 'call', 'wait', 'now', 'again', 'still', 'only', 'some', 'any', 'all',
  // Fillers and acks
  'yes', 'yeah', 'yep', 'yup', 'ok', 'okay', 'okey', 'alright', 'right', 'sure',
  'fine', 'good', 'great', 'cool', 'nice', 'hello', 'hallo', 'hi', 'hey', 'please',
  'thanks', 'thank', 'sorry', 'pardon', 'uh', 'um', 'umm', 'uhm', 'er', 'erm', 'ah',
  'eh', 'oh', 'mm', 'mmm', 'hmm', 'hm', 'huh', 'uhhuh', 'nope', 'nah',
  // Discourse fillers heard as a name ("like" on HD_1b3a67ea7ee9)
  'like', 'well', 'actually', 'basically', 'anyway', 'anyways', 'maybe',
  'hmmm', 'mhm', 'mmhm', 'uhuh', 'aah', 'ahh', 'ehh', 'ehe', 'yaani',
  // Honorifics on their own
  'sir', 'madam', 'mr', 'mrs', 'ms', 'miss', 'bwana', 'mzee',
  // Kiswahili
  'ndiyo', 'ndio', 'sawa', 'hapana', 'si', 'ni', 'na', 'ya', 'wa', 'la', 'za', 'kwa',
  'katika', 'hii', 'huyu', 'hiyo', 'yule', 'mimi', 'wewe', 'yeye', 'sisi', 'nini',
  'nani', 'wapi', 'lini', 'jina', 'langu', 'lako', 'naitwa', 'nauliza', 'asante',
  'karibu', 'habari', 'jambo', 'samahani', 'tafadhali', 'ngoja', 'subiri',
  'basi', 'sasa', 'bado', 'tu', 'pia', 'eeh', 'ee', 'eh',
  // Sheng
  'aje', 'poa', 'sasa', 'niaje', 'mambo', 'fiti', 'sema', 'ati', 'kwani', 'manze',
  'buda', 'msee', 'bro', 'boss',
  // Hear-again and stray words seen as prod alternates ("Rudia tena", "bad",
  // "Draft tech"). Never a person.
  'rudia', 'tena', 'repeat', 'bad', 'draft', 'tech',
]);

export function cleanCallerName(raw: unknown): string {
  return String(raw || "")
    .replace(/[.,;:]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function isJunkCallerName(raw: unknown): boolean {
  const name = cleanCallerName(raw);
  if (!name) return true;
  const lower = name.toLowerCase();
  const compact = lower.replace(/[\s'-]+/g, "");
  if (JUNK_CALLER_NAMES.has(lower) || JUNK_CALLER_NAMES.has(compact)) return true;
  if (/^(where|what|when|who|how|why)(\s+are you)?$/i.test(lower)) return true;
  if (compact === "ataround" || compact === "atround") return true;
  if (compact.replace(/[^\p{L}]/gu, "").length <= 2) return true;
  const words = lower
    .split(/\s+/)
    .map((w) => w.replace(/^[^\p{L}']+|[^\p{L}']+$/gu, ""))
    .filter(Boolean);
  if (!words.length) return true;
  if (words.every((w) => NAME_FUNCTION_WORDS.has(w))) return true;
  return false;
}

export function sanitizeStoredCallerName(raw: unknown): string | null {
  const name = cleanCallerName(raw);
  if (!name || isJunkCallerName(name)) return null;
  return name;
}
