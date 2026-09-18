/**
 * Keep in lockstep with src/conversation/callerNameMatch.js
 * Canonical caller-name spelling for live capture, CSV, and manual save.
 */

export function compactNameKey(value: unknown): string {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/['’`]/g, "")
    .replace(/[^a-z]/g, "");
}

function titleCaseWord(value: unknown): string {
  const lower = String(value || "").toLowerCase();
  if (!lower) return "";
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a) return b.length;
  if (!b) return a.length;
  if (Math.abs(a.length - b.length) > 2) return 99;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const cur = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    prev = cur;
  }
  return prev[b.length];
}

function maxEditDistance(heardKey: string, candidateKey: string): number {
  const minLen = Math.min(heardKey.length, candidateKey.length);
  if (minLen >= 7) return 2;
  if (minLen >= 4) return 1;
  return 0;
}

function fuzzyScore(heardKey: string, candidateKey: string): number {
  if (!heardKey || !candidateKey) return 0;
  if (heardKey === candidateKey) return 100;
  const distance = levenshtein(heardKey, candidateKey);
  if (distance > maxEditDistance(heardKey, candidateKey)) return 0;
  return distance === 1 ? 85 : 70;
}

export const KENYA_GIVEN_NAMES = [
  {
    canonical: "Aisha",
    aliases: [
      "eisha",
      "isha",
      "aiesha",
      "aysha",
      "eysha",
      "eyesha",
      "aicha",
      "aisa",
      "aesha",
    ],
  },
  { canonical: "Asha", aliases: [] as string[] },
  { canonical: "Wanjiku", aliases: ["wanjiko", "wanjikoo", "wanjiiku", "wanjeku"] },
  { canonical: "Wambui", aliases: ["wamboy", "wambuy", "wambooi"] },
  { canonical: "Njeri", aliases: ["njeree", "njery", "ngeri"] },
  { canonical: "Otieno", aliases: ["oteino", "otienoh"] },
  { canonical: "Ochieng", aliases: ["ocheng", "ochiengh"] },
  { canonical: "Kamau", aliases: ["kamaw", "kamao"] },
  { canonical: "Mwangi", aliases: ["mwangii", "mwange"] },
  { canonical: "Wanjiru", aliases: ["wanjiro", "wanjero"] },
  { canonical: "Nyambura", aliases: ["nyamura"] },
  { canonical: "Amina", aliases: ["ameena", "aminah", "ameenah"] },
  { canonical: "Atieno", aliases: ["ateino"] },
  { canonical: "Akinyi", aliases: ["akini"] },
  { canonical: "Adhiambo", aliases: ["adiambo"] },
  { canonical: "Omondi", aliases: ["omonde"] },
  { canonical: "Onyango", aliases: [] as string[] },
  { canonical: "Odhiambo", aliases: ["odiambo"] },
  { canonical: "Njoroge", aliases: ["njoronge", "joroge"] },
  { canonical: "Kipchoge", aliases: ["kipchogeh"] },
  { canonical: "Chebet", aliases: ["chebett"] },
  { canonical: "Fatuma", aliases: ["fatma", "fathuma", "fatmah"] },
  { canonical: "Hassan", aliases: ["hasan", "hassaan"] },
  { canonical: "Juma", aliases: [] as string[] },
  { canonical: "Baraka", aliases: [] as string[] },
];

function kenyaRows() {
  return KENYA_GIVEN_NAMES.map((row) => ({
    canonical: row.canonical,
    key: compactNameKey(row.canonical),
    aliases: new Set((row.aliases || []).map((alias) => compactNameKey(alias))),
  }));
}

const KENYA_ROWS = kenyaRows();

export const NAME_COLLISION_GROUPS = [
  ["Colin", "Collins"],
  ["Brian", "Bryan"],
  ["John", "Jon"],
  ["Ann", "Anne"],
  ["Sara", "Sarah"],
  ["Philip", "Phillip"],
  ["Stephen", "Steven"],
  ["Catherine", "Katherine"],
];

export function collisionGroupFor(name: unknown): string[] | null {
  const key = compactNameKey(name);
  if (!key) return null;
  for (const group of NAME_COLLISION_GROUPS) {
    if (group.some((option) => compactNameKey(option) === key)) {
      return [...group];
    }
  }
  return null;
}

export function sameCollisionGroup(a: unknown, b: unknown): boolean {
  const left = compactNameKey(a);
  const right = compactNameKey(b);
  if (!left || !right) return false;
  const group = collisionGroupFor(a);
  if (!group) return false;
  return group.some((option) => compactNameKey(option) === right);
}

function pairMember(name: unknown, group: unknown): string | null {
  const key = compactNameKey(name);
  if (!key || !Array.isArray(group)) return null;
  return group.find((option) => compactNameKey(option) === key) || null;
}

export function parseSpelledCallerName(text: unknown): string | null {
  const tokens = String(text || "")
    .replace(/[?.!]+/g, " ")
    .split(/[\s,.-]+/)
    .filter(Boolean);
  let run: string[] = [];
  const sequences: string[] = [];
  for (const token of tokens) {
    if (/^[A-Za-z]$/.test(token)) {
      run.push(token.toLowerCase());
    } else {
      if (run.length >= 3) sequences.push(run.join(""));
      run = [];
    }
  }
  if (run.length >= 3) sequences.push(run.join(""));
  if (!sequences.length) return null;
  return titleCaseWord(sequences[0]);
}

export function pickCollisionChoice(text: unknown, group: unknown): string | null {
  if (!Array.isArray(group) || !group.length) return null;
  const spelled = parseSpelledCallerName(text);
  if (spelled) {
    const fromSpelling = pairMember(spelled, group);
    if (fromSpelling) return fromSpelling;
  }
  const raw = String(text || "");
  let hit: string | null = null;
  for (const option of group) {
    const re = new RegExp(
      `\\b${String(option).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`,
      "i"
    );
    if (!re.test(raw)) continue;
    if (!hit || String(option).length > hit.length) hit = String(option);
  }
  return hit;
}

type KenyaRow = { canonical: string; key: string; aliases: Set<string> };

function scoreKenyaRow(heardKey: string, row: KenyaRow): number {
  if (!heardKey) return 0;
  if (heardKey === row.key) return 100;
  if (row.aliases.has(heardKey)) return 95;
  return fuzzyScore(heardKey, row.key);
}

type NameHit = {
  canonical: string;
  source: string;
  score: number;
  matched: string;
};

function bestKenyaMatch(heard: unknown): NameHit | null {
  const heardKey = compactNameKey(heard);
  if (!heardKey) return null;
  let best: NameHit | null = null;
  for (const row of KENYA_ROWS) {
    const score = scoreKenyaRow(heardKey, row);
    if (score <= 0) continue;
    if (!best || score > best.score) {
      best = {
        canonical: row.canonical,
        source: "kenya",
        score,
        matched: String(heard),
      };
    }
  }
  return best;
}

function bestKnownMatch(
  heard: unknown,
  knownNames: Array<{ name?: string; source?: string } | string> = []
): NameHit | null {
  const heardKey = compactNameKey(heard);
  if (!heardKey) return null;
  let best: NameHit | null = null;
  for (const row of Array.isArray(knownNames) ? knownNames : []) {
    const name = String(
      typeof row === "string" ? row : row?.name || ""
    ).trim();
    const key = compactNameKey(name);
    if (!key) continue;
    const collision = sameCollisionGroup(heardKey, key) ? 90 : 0;
    const score = Math.max(fuzzyScore(heardKey, key), collision);
    if (score <= 0) continue;
    if (!best || score > best.score) {
      best = {
        canonical: name,
        source: typeof row === "string" ? "known" : row?.source || "known",
        score,
        matched: String(heard),
      };
    }
  }
  return best;
}

export function matchCallerName(
  heard: unknown,
  opts: {
    knownNames?: Array<{ name?: string; source?: string } | string>;
    preferKnown?: boolean;
  } = {}
): NameHit | null {
  const raw = String(heard || "").trim();
  if (!raw) return null;
  const preferKnown = opts.preferKnown !== false;
  const knownHit = bestKnownMatch(raw, opts.knownNames);
  const kenyaHit = bestKenyaMatch(raw);

  if (preferKnown && knownHit && knownHit.score >= 85) return knownHit;
  if (knownHit && kenyaHit) {
    return knownHit.score >= kenyaHit.score ? knownHit : kenyaHit;
  }
  return knownHit || kenyaHit || null;
}

export function canonicalizeCallerName(
  heard: unknown,
  opts: {
    knownNames?: Array<{ name?: string; source?: string } | string>;
    preferKnown?: boolean;
  } = {}
): string | null {
  const raw = String(heard || "").trim();
  if (!raw) return null;
  const hit = matchCallerName(raw, opts);
  return hit ? hit.canonical : raw;
}

export function namesLikelySame(a: unknown, b: unknown): boolean {
  const left = String(a || "").trim();
  const right = String(b || "").trim();
  if (!left || !right) return false;
  if (compactNameKey(left) === compactNameKey(right)) return true;
  const leftKenya = bestKenyaMatch(left);
  const rightKenya = bestKenyaMatch(right);
  if (
    leftKenya &&
    rightKenya &&
    compactNameKey(leftKenya.canonical) === compactNameKey(rightKenya.canonical)
  ) {
    return true;
  }
  if (leftKenya && compactNameKey(leftKenya.canonical) === compactNameKey(right)) {
    return true;
  }
  if (rightKenya && compactNameKey(rightKenya.canonical) === compactNameKey(left)) {
    return true;
  }
  return sameCollisionGroup(left, right);
}

export function preferredContactSpelling(
  primary: unknown,
  incoming: unknown
): string | null {
  const kenyaIncoming = bestKenyaMatch(incoming);
  if (kenyaIncoming) return kenyaIncoming.canonical;
  const kenyaPrimary = bestKenyaMatch(primary);
  if (kenyaPrimary) return kenyaPrimary.canonical;
  if (primary && incoming && sameCollisionGroup(primary, incoming)) {
    return String(primary).trim();
  }
  return String(primary || incoming || "").trim() || null;
}

export function collectKnownCallerNames({
  profile = null,
  state = null,
}: {
  profile?: {
    callerMemory?: {
      fileOwnerName?: string | null;
      greetByName?: boolean;
      fileRole?: string | null;
      name?: string | null;
      alternateNames?: string[];
    };
  } | null;
  state?: { caller?: { name?: string | null } } | null;
} = {}): Array<{ name: string; source: string }> {
  const names: Array<{ name: string; source: string }> = [];
  const seen = new Set<string>();
  function push(name: unknown, source: string) {
    const value = String(name || "").trim();
    if (!value) return;
    const key = compactNameKey(value);
    if (!key || seen.has(key)) return;
    seen.add(key);
    names.push({ name: value, source });
  }
  const card = profile?.callerMemory;
  if (card?.fileOwnerName) {
    push(
      card.fileOwnerName,
      card.greetByName && card.fileRole === "primary" ? "memory" : "file"
    );
  }
  if (card?.name) push(card.name, card.greetByName ? "memory" : "file");
  for (const alt of card?.alternateNames || []) push(alt, "alternate");
  push(state?.caller?.name, "state");
  return names;
}
