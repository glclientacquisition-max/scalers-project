import type { TeamDirectoryEntry } from "@/lib/supabase";

export type TeamNotifyFlags = {
  receives_escalation: boolean;
  receives_inbox: boolean;
  receives_ops: boolean;
};

export const EMPTY_TEAM_NOTIFY_FLAGS: TeamNotifyFlags = {
  receives_escalation: false,
  receives_inbox: false,
  receives_ops: false,
};

export const CATCH_ALL_TEAM_NOTIFY_FLAGS: TeamNotifyFlags = {
  receives_escalation: true,
  receives_inbox: true,
  receives_ops: true,
};

export function directoryHasExplicitPermissions(raw: unknown): boolean {
  if (!Array.isArray(raw)) return false;
  return raw.some((row) => {
    if (!row || typeof row !== "object") return false;
    const r = row as Record<string, unknown>;
    return (
      typeof r.receives_escalation === "boolean" ||
      typeof r.receives_inbox === "boolean" ||
      typeof r.receives_ops === "boolean"
    );
  });
}

function asRoleKey(role: unknown): string {
  return String(role || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function isGeneralQueriesRole(role: unknown): boolean {
  const r = asRoleKey(role);
  if (!r) return false;
  if (
    /\bgeneral\b/.test(r) &&
    /\b(quer|inquir|request|support|help|desk|reception)\b/.test(r)
  ) {
    return true;
  }
  if (r === "general" || r === "general queries" || r === "general query") {
    return true;
  }
  if (r === "front desk" || r === "reception" || r === "receptionist") {
    return true;
  }
  return false;
}

export function isOwnerishRole(role: unknown): boolean {
  return /\b(ceo|owner|founder|director|md|managing director)\b/.test(
    asRoleKey(role)
  );
}

function phoneKey(raw: unknown): string {
  let digits = String(raw || "").replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) digits = digits.slice(1);
  if (digits.startsWith("0") && digits.length === 10) {
    digits = `254${digits.slice(1)}`;
  }
  return digits;
}

function phonesMatch(a: unknown, b: unknown): boolean {
  const left = phoneKey(a);
  const right = phoneKey(b);
  return Boolean(left && right && left === right);
}

export function inferTeamNotifyFlags(
  row: { role?: unknown; phone?: unknown },
  ownerPhone?: string
): TeamNotifyFlags {
  const receives_escalation = Boolean(String(row.phone || "").trim());
  const receives_inbox =
    isGeneralQueriesRole(row.role) ||
    isOwnerishRole(row.role) ||
    Boolean(ownerPhone && phonesMatch(row.phone, ownerPhone));
  return {
    receives_escalation,
    receives_inbox,
    receives_ops: receives_inbox,
  };
}

export function readTeamNotifyFlags(
  row: Record<string, unknown> | null | undefined,
  opts: { explicit: boolean; ownerPhone?: string } = { explicit: false }
): TeamNotifyFlags {
  if (opts.explicit) {
    return {
      receives_escalation: row?.receives_escalation === true,
      receives_inbox: row?.receives_inbox === true,
      receives_ops: row?.receives_ops === true,
    };
  }
  return inferTeamNotifyFlags(
    { role: row?.role, phone: row?.phone },
    opts.ownerPhone
  );
}

export function persistTeamNotifyFlags(
  row: Record<string, unknown> | null | undefined
): TeamNotifyFlags {
  return {
    receives_escalation: row?.receives_escalation === true,
    receives_inbox: row?.receives_inbox === true,
    receives_ops: row?.receives_ops === true,
  };
}

export function normalizeTeamDirectory(
  raw: unknown,
  opts: { ownerPhone?: string; requireName?: boolean; infer?: boolean } = {}
): TeamDirectoryEntry[] {
  if (!Array.isArray(raw)) return [];
  const explicit = directoryHasExplicitPermissions(raw);
  const infer = opts.infer !== false;
  return raw
    .map((row) => {
      if (!row || typeof row !== "object") return null;
      const r = row as Record<string, unknown>;
      const name = String(r.name || "").trim();
      const role = String(r.role || "").trim();
      const phone = String(r.phone || "").trim();
      const email = String(r.email || "").trim().toLowerCase();
      if (opts.requireName && !name) return null;
      if (!name && !role && !phone && !email) return null;
      const flags = explicit
        ? persistTeamNotifyFlags(r)
        : infer
          ? inferTeamNotifyFlags({ role, phone }, opts.ownerPhone)
          : {};
      return {
        name,
        role,
        phone,
        email,
        ...flags,
      };
    })
    .filter((row): row is TeamDirectoryEntry => Boolean(row));
}
