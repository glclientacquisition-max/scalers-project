import type { InboxJob } from "@/lib/inboxPurpose";

const PARENT_WORDS = new Set([
  "nairobi",
  "kenya",
  "county",
  "town",
  "area",
  "estate",
  "city",
  "in",
  "at",
  "the",
]);

const FINDABLE =
  /\b(gate|road|rd|street|st|avenue|ave|opposite|opp|near|behind|next|floor|shop|house|plot|building|mall|stage|junction)\b/i;

const STATUS_RANK: Record<string, number> = {
  confirmed: 4,
  requested: 3,
  done: 2,
  cancelled: 1,
};

function norm(raw: string | null | undefined): string {
  return String(raw || "")
    .replace(/\s+/g, " ")
    .trim();
}

function tokens(place: string): string[] {
  return place
    .toLowerCase()
    .replace(/[.,]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function editDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (Math.abs(m - n) > 3) return 99;
  const row = new Array<number>(n + 1);
  for (let j = 0; j <= n; j += 1) row[j] = j;
  for (let i = 1; i <= m; i += 1) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= n; j += 1) {
      const tmp = row[j];
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + cost);
      prev = tmp;
    }
  }
  return row[n];
}

function sharedSuffix(a: string, b: string): number {
  let i = 0;
  const limit = Math.min(a.length, b.length);
  while (i < limit && a[a.length - 1 - i] === b[b.length - 1 - i]) i += 1;
  return i;
}

function nearHearing(a: string, b: string): boolean {
  const left = a.toLowerCase();
  const right = b.toLowerCase();
  if (left === right) return true;
  if (tokens(a).length !== 1 || tokens(b).length !== 1) return false;
  if (Math.abs(left.length - right.length) > 3) return false;
  return sharedSuffix(left, right) >= 4 || editDistance(left, right) <= 2;
}

function parentOnlyExtra(shorter: string, longer: string): boolean {
  const shortTok = tokens(shorter);
  const longTok = tokens(longer);
  if (!shortTok.length || longTok.length <= shortTok.length) return false;
  const used = new Array<boolean>(longTok.length).fill(false);
  for (const token of shortTok) {
    const idx = longTok.findIndex((word, i) => !used[i] && word === token);
    if (idx < 0) return false;
    used[idx] = true;
  }
  const extra = longTok.filter((_, i) => !used[i]);
  return extra.length > 0 && extra.every((word) => PARENT_WORDS.has(word));
}

function findable(place: string): boolean {
  return FINDABLE.test(place);
}

function pickPair(first: string, next: string): string {
  const shorter = first.length <= next.length ? first : next;
  const longer = first.length <= next.length ? next : first;
  if (parentOnlyExtra(shorter, longer)) return shorter;
  if (nearHearing(first, next)) return longer;
  if (findable(longer) && !findable(shorter)) return longer;
  if (findable(shorter) && !findable(longer)) return shorter;
  return first;
}

/** One landmark for a call. Newest string is first. Parent tails drop. Hearing slips keep the longer token. */
export function pickVisitLandmark(
  places: Array<string | null | undefined>
): string | null {
  const unique: string[] = [];
  for (const raw of places) {
    const place = norm(raw);
    if (!place) continue;
    if (unique.some((row) => row.toLowerCase() === place.toLowerCase())) continue;
    unique.push(place);
  }
  if (!unique.length) return null;
  return unique.reduce((picked, place) => pickPair(picked, place));
}

function statusRank(status: string | null | undefined): number {
  return STATUS_RANK[String(status || "").toLowerCase()] || 0;
}

function overlayLandmark<T extends InboxJob>(group: T[]): T {
  if (group.length === 1) return group[0];
  const survivor = [...group].sort((a, b) => {
    const rank = statusRank(b.status) - statusRank(a.status);
    if (rank !== 0) return rank;
    if (a.created_at < b.created_at) return 1;
    if (a.created_at > b.created_at) return -1;
    return 0;
  })[0];
  const landmark = pickVisitLandmark(group.map((job) => job.address_landmark));
  if (!landmark || landmark === survivor.address_landmark) return survivor;
  return { ...survivor, address_landmark: landmark };
}

/**
 * One appointment row per call_id. Null call_id stays its own row.
 * List order follows the first sighting (newest-first queries stay newest-first).
 */
export function collapseJobsByCall<T extends InboxJob>(jobs: T[]): T[] {
  const groups = new Map<string, T[]>();
  for (const job of jobs) {
    const key = job.call_id?.trim() || "";
    if (!key) continue;
    const group = groups.get(key);
    if (group) group.push(job);
    else groups.set(key, [job]);
  }
  const emitted = new Set<string>();
  const collapsed: T[] = [];
  for (const job of jobs) {
    const key = job.call_id?.trim() || "";
    if (!key) {
      collapsed.push(job);
      continue;
    }
    if (emitted.has(key)) continue;
    emitted.add(key);
    collapsed.push(overlayLandmark(groups.get(key) || [job]));
  }
  return collapsed;
}
