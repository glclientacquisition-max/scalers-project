/**
 * Admin number controls v1 (27 Oct 2026): lift a quarantine early, move a live number
 * between businesses, and bring a business's number back (restore).
 * Pure: no `@/` imports, so node tests load it directly. The route is
 * app/api/admin/number-ops; the RPCs are Platform's #968 (service_role only).
 *
 * Every copy string here is operator-facing: plain words, "business" never the
 * database word for it, no long dashes.
 */

/** The protected platform line. Never changed from Admin, in any form (+254, 254, 07). */
export const PROTECTED_E164 = "+254709221536";
const PROTECTED_LAST9 = PROTECTED_E164.slice(-9);

export const NUMBER_OPS = ["restore", "lift_quarantine", "move"] as const;
export type NumberOp = (typeof NUMBER_OPS)[number];
export function isNumberOp(v: unknown): v is NumberOp {
  return typeof v === "string" && (NUMBER_OPS as readonly string[]).includes(v);
}

export const REASON_MIN = 3;
export const REASON_MAX = 500;

/** Calls can still reach the old business for this long after a move (Voice tenant cache). */
export const MOVE_CACHE_SECONDS = 30;

export const PROTECTED_COPY = "This is the protected platform line. Admin can't release, assign, hold, move or restore it.";

function digits(v: string): string {
  return v.replace(/\D/g, "");
}

/** Last 9 digits, same match the RPCs and Voice use. Null when it isn't a number. */
export function last9(v: unknown): string | null {
  if (typeof v !== "string" || /^pending:/i.test(v.trim())) return null;
  const d = digits(v);
  return d.length >= 9 ? d.slice(-9) : null;
}

export function isProtectedNumber(v: unknown): boolean {
  return last9(v) === PROTECTED_LAST9;
}

/**
 * Shared server refusal for every Admin number write (did-pool, number-hold, businesses,
 * number-ops). Pass any number fields from the request body. Pure: call it before any
 * database read or write. Returns the 403 body, or null when no protected number is named.
 */
export function protectedNumberRefusal(...numbers: unknown[]): { status: 403; body: { error: string; code: "protected_number" } } | null {
  return numbers.some((n) => isProtectedNumber(n))
    ? { status: 403, body: { error: PROTECTED_COPY, code: "protected_number" } }
    : null;
}

/** Business-level writes (archive, release by business id): refuse when its live number is the protected line. */
export const PROTECTED_BUSINESS_ACTIONS: ReadonlySet<string> = new Set(["archive", "release_did"]);

/** "+254 7xx", "2547xx", "07xx", "7xx" → "+2547xxxxxxxx". Null when it can't be a Kenyan number. */
export function normalizeKenyanE164(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const d = digits(v.trim());
  let local: string | null = null;
  if (d.length === 12 && d.startsWith("254")) local = d.slice(3);
  else if (d.length === 10 && d.startsWith("0")) local = d.slice(1);
  else if (d.length === 9) local = d;
  if (!local || !/^[17]\d{8}$/.test(local)) return null;
  return `+254${local}`;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isUuid(v: unknown): v is string {
  return typeof v === "string" && UUID.test(v);
}

export type NumberOpInput =
  | { action: "restore"; businessId: string; e164: string | null; reason: string }
  | { action: "lift_quarantine"; e164: string; reason: string; confirm: boolean }
  | { action: "move"; e164: string; fromBusinessId: string; toBusinessId: string; reason: string };

export type NumberOpReject = { ok: false; status: 400 | 403; code: string; error: string };
export type NumberOpValid = { ok: true; input: NumberOpInput };

function reject(status: 400 | 403, code: string, error: string): NumberOpReject {
  return { ok: false, status, code, error };
}

/**
 * Server-side check before step-up and before any RPC. The protected line is refused
 * here first (403), whatever the RPC would say. Empty or short reasons are refused.
 */
export function validateNumberOp(body: unknown): NumberOpValid | NumberOpReject {
  if (!body || typeof body !== "object") return reject(400, "bad_request", "Confirm the change.");
  const b = body as Record<string, unknown>;
  const action = b.action;
  if (!isNumberOp(action)) return reject(400, "unknown_action", "Unknown action.");

  const rawNumber = typeof b.e164 === "string" ? b.e164.trim() : "";
  if (rawNumber && isProtectedNumber(rawNumber)) return reject(403, "protected_number", PROTECTED_COPY);

  const reason = typeof b.reason === "string" ? b.reason.trim() : "";
  if (reason.length < REASON_MIN) return reject(400, "reason_required", "Add a reason (3 characters or more).");
  if (reason.length > REASON_MAX) return reject(400, "reason_too_long", "Keep the reason under 500 characters.");

  const e164 = rawNumber ? normalizeKenyanE164(rawNumber) : null;
  if (rawNumber && !e164) return reject(400, "bad_number", "That isn't a Kenyan phone number.");

  if (action === "restore") {
    if (!isUuid(b.business_id)) return reject(400, "business_required", "Pick the business to bring the number back to.");
    return { ok: true, input: { action, businessId: b.business_id, e164, reason } };
  }
  if (!e164) return reject(400, "number_required", "Number required.");
  if (action === "lift_quarantine") {
    return { ok: true, input: { action, e164, reason, confirm: b.confirm === true } };
  }
  if (!isUuid(b.from_business_id)) return reject(400, "from_required", "This number has no business to move from.");
  if (!isUuid(b.to_business_id)) return reject(400, "to_required", "Pick the business to move the number to.");
  if (b.from_business_id === b.to_business_id) {
    return reject(400, "same_business", "Pick a different business to move the number to.");
  }
  if (b.confirm !== true) return reject(400, "confirm_required", "Confirm the move to continue.");
  return { ok: true, input: { action, e164, fromBusinessId: b.from_business_id, toBusinessId: b.to_business_id, reason } };
}

/** RPC name + args for a valid input. Move always sends confirm=true (validated above). */
export function numberOpRpc(input: NumberOpInput, actor: string): { fn: string; args: Record<string, unknown> } {
  if (input.action === "restore") {
    return {
      fn: "admin_restore_business_number",
      args: { p_tenant_id: input.businessId, p_actor: actor, p_reason: input.reason, p_confirm: true, p_e164: input.e164 },
    };
  }
  if (input.action === "lift_quarantine") {
    return {
      fn: "admin_lift_quarantine",
      args: { p_e164: input.e164, p_actor: actor, p_reason: input.reason, p_confirm: input.confirm },
    };
  }
  return {
    fn: "admin_move_number",
    args: {
      p_e164: input.e164, p_from_tenant: input.fromBusinessId, p_to_tenant: input.toBusinessId,
      p_actor: actor, p_reason: input.reason, p_confirm: true,
    },
  };
}

type RpcBusiness = { id?: string; business_name?: string | null; sautikit_virtual_number?: string | null } | null | undefined;
type RpcPool = { e164?: string; status?: string; tenant_id?: string | null; last_tenant_id?: string | null; quarantine_until?: string | null } | null | undefined;
type RpcData = {
  ok?: boolean; action?: string; noop?: boolean; e164?: string;
  pool?: RpcPool; tenant?: RpcBusiness; from_tenant?: RpcBusiness; to_tenant?: RpcBusiness;
};

export type NumberOpResult = {
  ok: true;
  action: NumberOp;
  /** Repeat call: nothing changed because it was already done. Not an error. */
  noop: boolean;
  headline: string;
  e164: string;
  poolStatus: string | null;
  businessName: string | null;
  fromName: string | null;
  toName: string | null;
  /** Shown after a real move. */
  note: string | null;
};

const POOL_WORDS: Record<string, string> = {
  available: "Available",
  assigned: "Assigned",
  quarantine: "On hold",
  disabled: "Disabled",
  reserved: "Reserved",
};
export function poolStatusWords(s: string | null | undefined): string | null {
  return s ? POOL_WORDS[s] ?? s : null;
}

/** Plain summary of a successful (or already-done) RPC result. */
export function mapNumberOpResult(action: NumberOp, raw: unknown, fallbackE164: string | null = null): NumberOpResult {
  const d = (raw && typeof raw === "object" ? raw : {}) as RpcData;
  const noop = d.noop === true;
  const e164 = d.e164 || d.pool?.e164 || fallbackE164 || "";
  const name = (b: RpcBusiness) => (b && typeof b.business_name === "string" && b.business_name.trim() ? b.business_name.trim() : null);
  const businessName = name(d.tenant);
  const fromName = name(d.from_tenant);
  const toName = name(d.to_tenant);
  let headline: string;
  if (noop) headline = "Already done";
  else if (action === "restore") headline = `Number back with ${businessName ?? "the business"}`;
  else if (action === "lift_quarantine") headline = "Number is Available now";
  else headline = `Number moved to ${toName ?? "the new business"}`;
  return {
    ok: true,
    action,
    noop,
    headline,
    e164,
    poolStatus: poolStatusWords(d.pool?.status),
    businessName,
    fromName,
    toName,
    note:
      action === "move" && !noop
        ? `The first call in the next ${MOVE_CACHE_SECONDS} seconds can still reach ${fromName ?? "the old business"}. After that, calls go to ${toName ?? "the new business"}.`
        : null,
  };
}

export type NumberOpError = {
  status: number;
  code: string;
  error: string;
  /** Lift refused because its last business is active with no line: offer Restore, or free it with confirm. */
  suggestRestore?: boolean;
  needsConfirm?: boolean;
};

/** Raised text from the RPCs (#968) → owner-friendly copy. Order matters: first match wins. */
const ERROR_COPY: Array<[RegExp, Omit<NumberOpError, "status"> & { status?: number }]> = [
  [/protected number/i, { code: "protected_number", error: PROTECTED_COPY, status: 403 }],
  [/previous business is still active and has no line/i, {
    code: "last_business_waiting",
    error: "The business that last had this number is still active and has no line. Give it back with Restore, or free the number anyway.",
    suggestRestore: true,
    needsConfirm: true,
    status: 409,
  }],
  [/say who is making this change/i, { code: "actor_required", error: "Sign in again so we know who is making this change.", status: 401 }],
  [/a reason is required/i, { code: "reason_required", error: "Add a reason (3 characters or more)." }],
  [/confirm the change/i, { code: "confirm_required", error: "Confirm the change to continue." }],
  [/not a phone number/i, { code: "bad_number", error: "That isn't a phone number." }],
  [/number is not in our pool/i, { code: "not_in_pool", error: "That number isn't in the pool.", status: 404 }],
  [/no number in our pool to restore/i, {
    code: "nothing_to_restore",
    error: "There's no number on hold for this business. A number that has left the pool has to be bought again.",
    status: 404,
  }],
  [/not in quarantine/i, { code: "not_on_hold", error: "This number isn't on hold any more. Refresh to see where it is now.", status: 409 }],
  [/is disabled; restore refused/i, { code: "disabled", error: "This number is disabled, so it can't come back.", status: 409 }],
  [/is already available/i, { code: "already_available", error: "This number is already Available. Use Assign to give it to a business.", status: 409 }],
  [/for another business; restore refused/i, { code: "in_use", error: "This number is in use by another business.", status: 409 }],
  [/released from another business/i, { code: "other_business", error: "This number last belonged to a different business.", status: 409 }],
  [/business is archived or inactive; restore the business first/i, { code: "business_archived", error: "Restore the business first, then bring its number back.", status: 409 }],
  [/suspended by an admin/i, { code: "business_suspended", error: "This business is suspended. Unsuspend it first.", status: 409 }],
  [/closed for non-payment/i, { code: "non_payment", error: "The line was closed for non-payment. The business must be paid up first.", status: 409 }],
  [/business already has (a|another) (pool )?number/i, { code: "business_has_number", error: "This business already has a number.", status: 409 }],
  [/business to move to already (has|holds) a (pool )?number/i, {
    code: "target_has_number",
    error: "That business already has a number. Release its number first; swaps aren't supported.",
    status: 409,
  }],
  [/another business .* already has this number/i, {
    code: "number_held_elsewhere",
    error: "Another business already uses this number. Release or move it from that business first.",
    status: 409,
  }],
  [/not the live number of the business to move from/i, {
    code: "not_live_number",
    error: "This number isn't that business's live number any more. Refresh and try again.",
    status: 409,
  }],
  [/business to move from is archived or inactive/i, { code: "from_inactive", error: "The business it would move from is archived or paused.", status: 409 }],
  [/business to move to is archived or inactive/i, { code: "to_inactive", error: "The business you picked is archived or paused. Pick an active business.", status: 409 }],
  [/business to move (from|to) not found|business not found/i, { code: "business_not_found", error: "Business not found. Refresh and try again.", status: 404 }],
  [/pick a different business/i, { code: "same_business", error: "Pick a different business to move the number to." }],
  [/both businesses are required|business id required/i, { code: "business_required", error: "Pick the business first." }],
];

const MISSING_FN = /could not find the function|PGRST202|function .* does not exist|42883/i;

export const NUMBER_OPS_SQL_MISSING = "Number controls need Platform's latest SQL on this database. Nothing was changed.";
export const NUMBER_OPS_FALLBACK = "Couldn't make the change. Nothing was changed.";

/** Map a Supabase/PostgREST error ({ message, code, hint }) to plain copy. Raw text never reaches the screen. */
export function mapNumberOpError(raw: unknown): NumberOpError {
  const e = (raw && typeof raw === "object" ? raw : { message: String(raw ?? "") }) as {
    message?: unknown; code?: unknown; hint?: unknown; details?: unknown;
  };
  const message = typeof e.message === "string" ? e.message : "";
  const code = typeof e.code === "string" ? e.code : "";
  const hint = typeof e.hint === "string" ? e.hint : "";
  if (MISSING_FN.test(`${message} ${code}`)) return { status: 503, code: "sql_missing", error: NUMBER_OPS_SQL_MISSING };
  if (code === "42501") return { status: 403, code: "protected_number", error: PROTECTED_COPY };
  for (const [re, out] of ERROR_COPY) {
    if (re.test(message)) return { status: out.status ?? 400, ...out };
  }
  if (/restore/i.test(hint)) {
    return { status: 409, code: "use_restore", error: "Use Restore to give this number back to its business.", suggestRestore: true };
  }
  return { status: 400, code: "rpc_error", error: NUMBER_OPS_FALLBACK };
}

/** Which controls a pool row offers, and why one is off. Same rules the server applies. */
export function numberOpsFor(row: {
  e164: string;
  status: string;
  businessId: string | null;
  lastBusinessId: string | null;
  businessActive: boolean | null;
}): { protectedLine: boolean; lift: boolean; restore: boolean; move: boolean } {
  const protectedLine = isProtectedNumber(row.e164);
  const onHold = row.status === "quarantine" && !row.businessId;
  return {
    protectedLine,
    lift: onHold,
    restore: onHold && Boolean(row.lastBusinessId),
    move: row.status === "assigned" && Boolean(row.businessId) && row.businessActive !== false,
  };
}
