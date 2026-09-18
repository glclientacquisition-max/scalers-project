import { normalizeTeamDirectory } from "@/lib/teamNotify";

export const INBOX_SNOOZE_MS = 24 * 60 * 60 * 1000;
export const INBOX_LABEL_MAX = 40;
export const INBOX_LABELS_MAX = 12;

export type InboxTeammateOption = {
  value: string;
  label: string;
};

export function inboxSnoozeUntilIso(now = Date.now()): string {
  return new Date(now + INBOX_SNOOZE_MS).toISOString();
}

export function parseInboxLabels(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const row of raw) {
    const label = sanitizeInboxLabel(row);
    if (!label) continue;
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(label);
    if (out.length >= INBOX_LABELS_MAX) break;
  }
  return out;
}

export function sanitizeInboxLabel(raw: unknown): string | null {
  const value = String(raw || "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, INBOX_LABEL_MAX);
  return value || null;
}

export function inboxTeammateOptions(raw: unknown): InboxTeammateOption[] {
  const team = normalizeTeamDirectory(raw, { requireName: true, infer: false });
  const out: InboxTeammateOption[] = [];
  const seen = new Set<string>();
  const names = new Map<string, number>();
  for (const row of team) {
    const key = row.name.toLowerCase();
    names.set(key, (names.get(key) || 0) + 1);
  }
  for (const row of team) {
    const phone = row.phone.trim();
    const duplicate = (names.get(row.name.toLowerCase()) || 0) > 1;
    const value = phone ? `${row.name} (${phone})` : row.name;
    if (seen.has(value)) continue;
    seen.add(value);
    out.push({
      value,
      label: duplicate && phone ? `${row.name} (${phone})` : row.name,
    });
  }
  return out;
}

export function isInboxTeammateValue(
  raw: string,
  options: InboxTeammateOption[]
): boolean {
  return options.some((row) => row.value === raw);
}
