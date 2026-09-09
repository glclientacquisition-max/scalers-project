import { mergeContactIdentity } from "@/lib/contactIdentity";
import { normalizeKenyaE164, normalizeStoredPhone } from "@/lib/handoffMode";

export const CONTACT_CSV_MAX_ROWS = 500;

export type ContactDraft = {
  rowNumber?: number;
  phone: string;
  name: string | null;
  notes: string | null;
  metadata: Record<string, unknown>;
};

export type ContactCsvRejected = {
  rowNumber: number;
  phone: string | null;
  name: string | null;
  reason: string;
};

export type ContactCsvSkipped = {
  rowNumber: number;
  phone: string;
  name: string | null;
  reason: string;
  existingId: string | null;
};

export type ContactCsvPlan = {
  ok: true;
  create: ContactDraft[];
  skipped: ContactCsvSkipped[];
  rejected: ContactCsvRejected[];
  summary: { create: number; skipped: number; rejected: number };
};

function trimField(raw: unknown): string | null {
  const value = String(raw || "").trim();
  return value || null;
}

export function parseDialableContactPhone(
  raw: unknown
): { ok: true; phone: string } | { ok: false; error: string } {
  const trimmed = String(raw || "").trim();
  if (!trimmed) return { ok: false, error: "Phone is required." };
  const stored = normalizeStoredPhone(trimmed);
  const e164 = normalizeKenyaE164(trimmed);
  if (!stored || !e164 || stored !== e164) {
    return { ok: false, error: "Phone is not a Kenyan number." };
  }
  return { ok: true, phone: e164 };
}

export function buildNewContactIdentity(name: unknown) {
  return mergeContactIdentity(null, { name: trimField(name) });
}

function parseCsvRecords(
  text: string
): { ok: true; rows: string[][] } | { ok: false; error: string } {
  const src = String(text || "").replace(/^\uFEFF/, "");
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    const next = src[i + 1];
    if (inQuotes) {
      if (ch === '"' && next === '"') {
        field += '"';
        i += 1;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === ",") {
      row.push(field);
      field = "";
      continue;
    }
    if (ch === "\n") {
      row.push(field);
      field = "";
      rows.push(row);
      row = [];
      continue;
    }
    if (ch === "\r") continue;
    field += ch;
  }
  if (inQuotes) return { ok: false, error: "CSV has an unclosed quote." };
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  while (
    rows.length &&
    rows[rows.length - 1].every((cell) => !String(cell || "").trim())
  ) {
    rows.pop();
  }
  return { ok: true, rows };
}

export function parseContactCsv(
  text: string
):
  | {
      ok: true;
      records: Array<{
        rowNumber: number;
        name: string | null;
        phone: string | null;
        notes: string | null;
      }>;
    }
  | { ok: false; error: string } {
  const parsed = parseCsvRecords(text);
  if (!parsed.ok) return parsed;
  if (!parsed.rows.length) {
    return { ok: false, error: "CSV is empty. Include a header row: name,phone,notes." };
  }
  const map: Record<string, number> = {};
  parsed.rows[0].forEach((cell, i) => {
    map[String(cell || "").trim().toLowerCase()] = i;
  });
  if (!("name" in map) || !("phone" in map) || !("notes" in map)) {
    return { ok: false, error: "Header row must include name, phone, and notes." };
  }
  const data = parsed.rows.slice(1);
  if (data.length > CONTACT_CSV_MAX_ROWS) {
    return {
      ok: false,
      error: `CSV has ${data.length} data rows. Max is ${CONTACT_CSV_MAX_ROWS}.`,
    };
  }
  return {
    ok: true,
    records: data.map((cells, i) => ({
      rowNumber: i + 2,
      name: trimField(cells[map.name]),
      phone: trimField(cells[map.phone]),
      notes: trimField(cells[map.notes]),
    })),
  };
}

export function planContactCsv(
  text: string,
  existingByPhone: Record<string, string> = {}
): ContactCsvPlan | { ok: false; error: string } {
  const parsed = parseContactCsv(text);
  if (!parsed.ok) return parsed;

  const create: ContactDraft[] = [];
  const skipped: ContactCsvSkipped[] = [];
  const rejected: ContactCsvRejected[] = [];
  const seen = new Map<string, number>();

  for (const rec of parsed.records) {
    const phoneResult = parseDialableContactPhone(rec.phone);
    if (!phoneResult.ok) {
      rejected.push({
        rowNumber: rec.rowNumber,
        phone: rec.phone,
        name: rec.name,
        reason: phoneResult.error,
      });
      continue;
    }
    const phone = phoneResult.phone;
    if (seen.has(phone)) {
      skipped.push({
        rowNumber: rec.rowNumber,
        phone,
        name: rec.name,
        reason: "Duplicate phone in this file",
        existingId: null,
      });
      continue;
    }
    seen.set(phone, rec.rowNumber);
    const existingId = existingByPhone[phone] || null;
    if (existingId) {
      skipped.push({
        rowNumber: rec.rowNumber,
        phone,
        name: rec.name,
        reason: "Already exists",
        existingId,
      });
      continue;
    }
    const identity = buildNewContactIdentity(rec.name);
    create.push({
      rowNumber: rec.rowNumber,
      phone,
      name: identity.name,
      notes: rec.notes,
      metadata: identity.metadata,
    });
  }

  return {
    ok: true,
    create,
    skipped,
    rejected,
    summary: {
      create: create.length,
      skipped: skipped.length,
      rejected: rejected.length,
    },
  };
}

export function planManualContact(opts: {
  name?: unknown;
  phone?: unknown;
  notes?: unknown;
  existingId?: string | null;
}):
  | {
      ok: true;
      phone: string;
      name: string | null;
      notes: string | null;
      metadata: Record<string, unknown>;
    }
  | { ok: false; error: string; existingId?: string; phone?: string } {
  const phoneResult = parseDialableContactPhone(opts.phone);
  if (!phoneResult.ok) return { ok: false, error: phoneResult.error };
  if (opts.existingId) {
    return {
      ok: false,
      error: "Already saved",
      existingId: opts.existingId,
      phone: phoneResult.phone,
    };
  }
  const identity = buildNewContactIdentity(opts.name);
  return {
    ok: true,
    phone: phoneResult.phone,
    name: identity.name,
    notes: trimField(opts.notes),
    metadata: identity.metadata,
  };
}

export function isContactPickerAvailable(
  globalObj: { navigator?: object; ContactsManager?: unknown } | null
): boolean {
  if (!globalObj || typeof globalObj !== "object") return false;
  const nav = globalObj.navigator;
  return Boolean(nav && "contacts" in nav && "ContactsManager" in globalObj);
}

export function mapPickedContacts(
  entries: Array<{ name?: string[]; tel?: string[] }> | null | undefined
): Array<{ name: string | null; phone: string | null; notes: string | null }> {
  return (entries || []).map((row) => ({
    name: trimField(row?.name?.[0]),
    phone: trimField(row?.tel?.[0]),
    notes: null,
  }));
}
