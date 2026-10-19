/** M-Pesa's per-transaction cap. Parts never exceed this. */
const MPESA_TX_LIMIT_KES = 150000;
const LIMIT_CENTS = BigInt(MPESA_TX_LIMIT_KES) * 100n;

/**
 * Whole cents from a decimal string or bigint. Rejects JS numbers and more than 2 decimal places.
 * @param {unknown} amount
 * @returns {bigint | null}
 */
function toCents(amount) {
  if (typeof amount === "bigint") return amount;
  // A JS number rounds through toFixed and can drop a cent (1.005 -> "1.00").
  if (typeof amount === "number") return null;
  const s = String(amount ?? "").trim();
  const m = /^(-)?(\d+)(?:\.(\d+))?$/.exec(s);
  if (!m) return null;
  const frac = m[3] || "";
  if (frac.length > 2) return null;
  const cents = BigInt(m[2]) * 100n + BigInt((frac + "00").slice(0, 2));
  return m[1] ? -cents : cents;
}

/** @param {bigint} cents */
function fromCents(cents) {
  const neg = cents < 0n;
  const abs = neg ? -cents : cents;
  const whole = abs / 100n;
  const frac = abs % 100n;
  const body = frac === 0n ? whole.toString() : `${whole}.${frac.toString().padStart(2, "0")}`;
  return neg ? `-${body}` : body;
}

/**
 * Even split in cents. Each part is at most KSh 150,000 and the parts sum to the total.
 * @param {unknown} totalKes
 * @returns {string[]}
 */
function splitKes(totalKes) {
  const total = toCents(totalKes);
  if (total == null || total <= 0n) return [];
  if (total <= LIMIT_CENTS) return [fromCents(total)];
  const n = Number((total + LIMIT_CENTS - 1n) / LIMIT_CENTS);
  const base = total / BigInt(n);
  let rem = total % BigInt(n);
  const parts = [];
  for (let i = 0; i < n; i += 1) {
    const extra = rem > 0n ? 1n : 0n;
    if (extra) rem -= 1n;
    parts.push(fromCents(base + extra));
  }
  return parts;
}

/**
 * The next unpaid slice. Index is 1-based.
 * @param {string[]} parts
 * @param {unknown} amountPaidKes
 * @returns {{ index: number, count: number, amountKes: string } | null}
 */
function nextPart(parts, amountPaidKes) {
  const paid = toCents(amountPaidKes ?? 0);
  if (paid == null || parts.length === 0) return null;
  let cursor = 0n;
  for (let i = 0; i < parts.length; i += 1) {
    const size = toCents(parts[i]);
    if (size == null) return null;
    if (paid < cursor + size) {
      return {
        index: i + 1,
        count: parts.length,
        amountKes: fromCents(cursor + size - paid),
      };
    }
    cursor += size;
  }
  return null;
}

const kshGroup = /\B(?=(\d{3})+(?!\d))/g;

/** @param {bigint | null} cents */
function formatKsh(cents) {
  if (cents == null) return "KSh 0";
  const neg = cents < 0n;
  const abs = neg ? -cents : cents;
  const whole = (abs / 100n).toString().replace(kshGroup, ",");
  const frac = abs % 100n;
  const body = frac === 0n ? whole : `${whole}.${frac.toString().padStart(2, "0")}`;
  return `KSh ${neg ? "-" : ""}${body}`;
}

const dueFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Africa/Nairobi",
  day: "numeric",
  month: "short",
  year: "numeric",
});

/** @param {string | null | undefined} iso */
function formatDue(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return dueFormatter.format(d);
}

module.exports = {
  MPESA_TX_LIMIT_KES,
  toCents,
  fromCents,
  splitKes,
  nextPart,
  formatKsh,
  formatDue,
};
