import crypto from "crypto";

export type AdminOperator = {
  username: string;
  accessCode: string;
};

const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{1,31}$/;

export function normalizeAdminUsername(raw: string): string {
  return String(raw || "").trim().toLowerCase();
}

export function isAdminUsernameShape(username: string): boolean {
  return USERNAME_RE.test(username);
}

/**
 * Operator list for Super Admin.
 * Prefer `ADMIN_OPERATORS=kigen:code,mercy:code`.
 * Else shared `ADMIN_ACCESS_CODE` (or `DASHBOARD_PASSWORD`) + `ADMIN_USERNAMES`.
 */
export function parseAdminOperators(
  env: NodeJS.ProcessEnv = process.env
): AdminOperator[] {
  const operatorsRaw = String(env.ADMIN_OPERATORS || "").trim();
  if (operatorsRaw) {
    const parsed: AdminOperator[] = [];
    for (const part of operatorsRaw.split(",")) {
      const trimmed = part.trim();
      if (!trimmed) continue;
      const colon = trimmed.indexOf(":");
      if (colon <= 0) continue;
      const username = normalizeAdminUsername(trimmed.slice(0, colon));
      const accessCode = trimmed.slice(colon + 1);
      if (!isAdminUsernameShape(username) || !accessCode) continue;
      parsed.push({ username, accessCode });
    }
    return parsed;
  }

  const shared = String(env.ADMIN_ACCESS_CODE || env.DASHBOARD_PASSWORD || "");
  const names = String(env.ADMIN_USERNAMES || "admin")
    .split(",")
    .map(normalizeAdminUsername)
    .filter(isAdminUsernameShape);
  if (!shared || names.length === 0) return [];
  return names.map((username) => ({ username, accessCode: shared }));
}

export function findAdminOperator(
  username: string,
  env: NodeJS.ProcessEnv = process.env
): AdminOperator | null {
  const normalized = normalizeAdminUsername(username);
  return parseAdminOperators(env).find((op) => op.username === normalized) ?? null;
}

export function accessCodeMatches(provided: string, expected: string): boolean {
  const a = Buffer.from(String(provided));
  const b = Buffer.from(String(expected));
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export function verifyAdminAccess(
  username: string,
  accessCode: string,
  env: NodeJS.ProcessEnv = process.env
): AdminOperator | null {
  const operator = findAdminOperator(username, env);
  if (!operator) return null;
  if (!accessCodeMatches(accessCode, operator.accessCode)) return null;
  return operator;
}
