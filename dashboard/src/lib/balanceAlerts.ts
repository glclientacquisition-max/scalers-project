/**
 * Phone-wallet and TextSMS credit notices for the ops cron.
 * Pure: no network, no env reads, no secrets. The cron passes a balance it
 * already read through an authenticated server-side call.
 *
 * A threshold alerts once when the balance crosses it downward, then stays
 * quiet until the balance is seen strictly above it (re-arm). One drop past
 * several wallet thresholds opens one mailed notice, for the lowest, and
 * latches the others without a second mail. An empty wallet is the one mail
 * for that reading. An unknown balance neither alerts nor re-arms.
 *
 * Top-up: one "topped up" mail when the highest open wallet threshold re-arms
 * (balance above threshold * 1.1, so KES 550 for KES 500). Lower thresholds and
 * the empty notice resolve quietly, so one top-up sends one mail.
 *
 * Staging wallet: the same signals under the `sautikit_low:staging` prefix
 * (prod Desk reads it with a wallet.read-only staging key), default KES 300.
 */

export const LEGACY_WALLET_KIND = "sautikit_low";
export const WALLET_EMPTY_KIND = "sautikit_low:empty";
/** Staging wallet notices share the Money toggle: base kind stays sautikit_low. */
export const STAGING_WALLET_PREFIX = "sautikit_low:staging";
export const DEFAULT_STAGING_WALLET_THRESHOLDS_KES = [300];
export const SMS_LEVELS = ["warn", "critical", "exhausted"] as const;
export type SmsCreditLevel = (typeof SMS_LEVELS)[number];

export const DEFAULT_WALLET_THRESHOLDS_KES = [500, 100];
export const DEFAULT_SMS_WARN_BELOW = 100;
export const DEFAULT_SMS_CRITICAL_AT = 20;
/** Stay latched until the balance is above threshold * (1 + margin). */
export const DEFAULT_REARM_MARGIN = 0.1;

export type CronSignal = {
  kind: string;
  active: boolean;
  detail: string;
  /** False latches the notice without sending. */
  mail: boolean;
  /** False means resolving re-arms with no recovery mail. */
  recoverMail: boolean;
  /** Unknown reading: leave any open notice as it is. */
  hold: boolean;
};

export function walletThresholdKind(minor: number, prefix: string = LEGACY_WALLET_KIND): string {
  return `${prefix}:${minor}`;
}

export function walletEmptyKind(prefix: string = LEGACY_WALLET_KIND): string {
  return `${prefix}:empty`;
}

export function isStagingWalletKind(kind: string): boolean {
  return String(kind || "").startsWith(`${STAGING_WALLET_PREFIX}:`);
}

export function smsLevelKind(level: SmsCreditLevel): string {
  return `sms_credit:${level}`;
}

export function noticeBaseKind(kind: string): string {
  const base = String(kind || "").split(":")[0];
  return base || kind;
}

function signal(partial: Partial<CronSignal> & Pick<CronSignal, "kind">): CronSignal {
  return {
    active: false,
    detail: "",
    mail: true,
    recoverMail: true,
    hold: false,
    ...partial,
  };
}

function hold(kind: string): CronSignal {
  return signal({ kind, hold: true, mail: false, recoverMail: false });
}

/** Whole KES for staff mail. Minor units in, no currency symbol games. */
export function kesLabel(minor: number): string {
  const kes = Number(minor) / 100;
  if (!Number.isFinite(kes)) return "KES ?";
  const text = Number.isInteger(kes) ? String(kes) : kes.toFixed(2);
  return `KES ${text}`;
}

/**
 * Comma-separated KES amounts. Empty or all-invalid input uses the defaults
 * (500 and 100 for the prod wallet). Returns minor units, highest first, duplicates dropped.
 */
export function parseWalletThresholdsKes(
  raw: string | null | undefined,
  defaultsKes: readonly number[] = DEFAULT_WALLET_THRESHOLDS_KES,
): number[] {
  const fallback = () => [...new Set(defaultsKes.map((kes) => Math.round(kes * 100)))].sort((a, b) => b - a);
  const text = String(raw ?? "").trim();
  if (!text) return fallback();
  const out = new Set<number>();
  for (const part of text.split(/[\s,;]+/)) {
    if (!part) continue;
    const kes = Number(part);
    if (!Number.isFinite(kes) || kes <= 0) continue;
    out.add(Math.round(kes * 100));
  }
  if (!out.size) return fallback();
  return [...out].sort((a, b) => b - a);
}

/**
 * Fraction above the threshold. `0.10` and `10%` both mean ten percent.
 * A number greater than 1 is read as a percent (10 means 10%).
 */
export function parseRearmMargin(raw: string | null | undefined, fallback = DEFAULT_REARM_MARGIN): number {
  const text = String(raw ?? "").trim();
  if (!text) return fallback;
  const value = Number(text.replace(/%$/, ""));
  if (!Number.isFinite(value) || value < 0) return fallback;
  if (text.endsWith("%") || value > 1) return value / 100;
  return value;
}

/** Minor units. The notice stays open until the balance is strictly above this. */
export function rearmCeilingMinor(thresholdMinor: number, margin: number): number {
  const m = Number.isFinite(margin) && margin >= 0 ? margin : DEFAULT_REARM_MARGIN;
  // Round first: 50000 * 1.1 is 55000.000000000007 in floating point, which must read as KES 550.
  return Math.ceil(Math.round(thresholdMinor * (1 + m) * 1e6) / 1e6);
}

/**
 * Crossed when the balance is at or under the threshold.
 * An open notice stays crossed until the balance is above the ceiling.
 */
export function balanceStillLow(balance: number, threshold: number, open: boolean, margin: number): boolean {
  if (balance <= threshold) return true;
  if (!open) return false;
  return balance <= rearmCeilingMinor(threshold, margin);
}

/** Admin low-money amount plus the env list. Zero or blank admin amount is skipped. */
export function walletThresholdsMinor(
  envRaw: string | null | undefined,
  adminWarnMinor: number,
): number[] {
  const out = new Set(parseWalletThresholdsKes(envRaw));
  const warn = Math.round(Number(adminWarnMinor));
  if (Number.isFinite(warn) && warn > 0) out.add(warn);
  return [...out].sort((a, b) => b - a);
}

type OpenNotice = { kind: string; notified_at?: string | null; status?: string };

function liveNotices(notices: readonly OpenNotice[]): OpenNotice[] {
  return notices.filter((notice) => !notice.status || notice.status === "open" || notice.status === "acked");
}

export function walletSignals(input: {
  balanceMinor: number | null;
  thresholdsMinor: number[];
  openNotices: readonly OpenNotice[];
  /** Default 0.10. Re-arm only above threshold * (1 + margin). */
  rearmMargin?: number;
  /** Kind prefix. Default `sautikit_low` (prod wallet); STAGING_WALLET_PREFIX for staging. */
  kindPrefix?: string;
}): CronSignal[] {
  const prefix = input.kindPrefix || LEGACY_WALLET_KIND;
  const primary = prefix === LEGACY_WALLET_KIND;
  const emptyKind = walletEmptyKind(prefix);
  const thresholdKind = (minor: number) => walletThresholdKind(minor, prefix);
  const walletName = primary ? "Phone wallet" : "Staging phone wallet";
  const open = liveNotices(input.openNotices);
  const openKinds = new Set(open.map((notice) => notice.kind));
  const notified = new Set(open.filter((notice) => notice.notified_at).map((notice) => notice.kind));
  const thresholds = [...new Set(input.thresholdsMinor.filter((n) => Number.isFinite(n) && n > 0))].sort(
    (a, b) => b - a,
  );
  const managed = [...(primary ? [LEGACY_WALLET_KIND] : []), emptyKind, ...thresholds.map(thresholdKind)];
  if (input.balanceMinor == null || !Number.isFinite(input.balanceMinor)) {
    return managed.map(hold);
  }

  const balance = input.balanceMinor;
  const margin = input.rearmMargin ?? DEFAULT_REARM_MARGIN;
  const empty = balance <= 0;
  const crossed = thresholds.filter((threshold) => balance <= threshold);
  const unsent = crossed.filter((threshold) => !notified.has(thresholdKind(threshold)));
  const lowestUnsent = unsent.length ? Math.min(...unsent) : null;
  const lowestOpen = crossed.length ? Math.min(...crossed) : null;
  const lowDetail =
    lowestOpen == null ? "" : `${kesLabel(balance)}, below ${kesLabel(lowestOpen)}`;
  // The one threshold whose re-arm sends the top-up mail: the highest still open.
  const openThresholds = thresholds.filter((threshold) => openKinds.has(thresholdKind(threshold)));
  const topOpen = openThresholds.length ? Math.max(...openThresholds) : null;
  const emptyDetail = `${walletName} is empty`;
  const tag = primary ? "" : `${walletName}: `;

  const signals: CronSignal[] = [];
  if (primary) {
    const legacyOpen = openKinds.has(LEGACY_WALLET_KIND);
    signals.push(
      legacyOpen
        ? signal({
            kind: LEGACY_WALLET_KIND,
            active: empty || crossed.length > 0,
            detail: empty ? emptyDetail : lowDetail || `${walletName} topped up: ${kesLabel(balance)}`,
            // Already mailed by the old page-load check. Threshold rows carry any new mail.
            mail: false,
            // A threshold notice carries the top-up mail when one is open.
            recoverMail: topOpen == null,
          })
        : hold(LEGACY_WALLET_KIND),
    );
  }
  signals.push(
    signal({
      kind: emptyKind,
      active: empty,
      detail: emptyDetail,
      mail: empty && !notified.has(emptyKind),
      recoverMail: false,
    }),
  );

  for (const threshold of thresholds) {
    const kind = thresholdKind(threshold);
    const isCrossed = balance <= threshold;
    const open = openKinds.has(kind);
    const active = balanceStillLow(balance, threshold, open, margin);
    const ceiling = rearmCeilingMinor(threshold, margin);
    signals.push(
      signal({
        kind,
        active,
        detail: !active
          ? `${walletName} topped up: ${kesLabel(balance)}, back above ${kesLabel(ceiling)}`
          : open && !isCrossed
            ? `${tag}${kesLabel(balance)}, holding until ${kesLabel(ceiling)}`
            : `${tag}${kesLabel(balance)}, below ${kesLabel(threshold)}`,
        mail: !empty && isCrossed && lowestUnsent === threshold,
        recoverMail: threshold === topOpen,
      }),
    );
  }
  return signals;
}

export function classifySmsCredit(
  balance: number | null,
  thresholds: { warnBelow: number; criticalAt: number } = {
    warnBelow: DEFAULT_SMS_WARN_BELOW,
    criticalAt: DEFAULT_SMS_CRITICAL_AT,
  },
): "unknown" | "ok" | SmsCreditLevel {
  if (balance == null || !Number.isFinite(Number(balance))) return "unknown";
  const value = Number(balance);
  if (value <= 0) return "exhausted";
  if (value <= thresholds.criticalAt) return "critical";
  if (value < thresholds.warnBelow) return "warn";
  return "ok";
}

function smsDetail(level: SmsCreditLevel, balance: number, thresholds: { warnBelow: number; criticalAt: number }): string {
  const credits = Number.isInteger(balance) ? String(balance) : String(Math.round(balance));
  if (level === "exhausted") return "SMS credits are at 0";
  if (level === "critical") return `${credits} credits, at or below ${thresholds.criticalAt}`;
  return `${credits} credits, below ${thresholds.warnBelow}`;
}

const SMS_RANK: Record<"ok" | SmsCreditLevel, number> = { ok: 0, warn: 1, critical: 2, exhausted: 3 };

export function smsSignals(input: {
  balance: number | null;
  /** getbalance HTTP 402 or provider code 1008. Treated as zero credits. */
  exhausted?: boolean;
  warnBelow: number;
  criticalAt: number;
  openNotices: readonly OpenNotice[];
}): CronSignal[] {
  const open = liveNotices(input.openNotices);
  const notified = new Set(open.filter((notice) => notice.notified_at).map((notice) => notice.kind));
  const keys = SMS_LEVELS.map(smsLevelKind);
  if (input.balance == null && !input.exhausted) return keys.map(hold);

  const balance = input.exhausted ? 0 : Number(input.balance);
  const level = classifySmsCredit(balance, {
    warnBelow: input.warnBelow,
    criticalAt: input.criticalAt,
  });
  const current = SMS_RANK[level === "unknown" ? "ok" : level];
  let mailLevel: SmsCreditLevel | null = null;
  for (const name of ["exhausted", "critical", "warn"] as const) {
    if (SMS_RANK[name] <= current && SMS_RANK[name] > 0 && !notified.has(smsLevelKind(name))) {
      mailLevel = name;
      break;
    }
  }

  return SMS_LEVELS.map((name) => {
    const active = SMS_RANK[name] > 0 && SMS_RANK[name] <= current;
    return signal({
      kind: smsLevelKind(name),
      active,
      detail: smsDetail(name, balance, { warnBelow: input.warnBelow, criticalAt: input.criticalAt }),
      mail: mailLevel === name,
      recoverMail: false,
    });
  });
}

export type HealthKnown = { speech: boolean; reasoning: boolean; phone: boolean };

/** Provider health from Voice. A missing payload is unknown, not recovered. */
export function voiceHealthKnown(payload: {
  status: "ok" | "unreachable" | "invalid";
  soniox?: unknown;
  gemini?: unknown;
} | null): Pick<HealthKnown, "speech" | "reasoning"> {
  if (!payload || payload.status !== "ok") return { speech: false, reasoning: false };
  return { speech: payload.soniox != null, reasoning: payload.gemini != null };
}

type BaseSignal = { kind: string; active: boolean; detail: string };

/** Board signals, minus the single Money row (threshold notices replace it). */
export function platformCronSignals(base: BaseSignal[], known: HealthKnown): CronSignal[] {
  return base
    .filter((row) => row.kind !== LEGACY_WALLET_KIND)
    .map((row) => {
      const holdRow =
        (row.kind === "speech" && !known.speech) ||
        (row.kind === "reasoning" && !known.reasoning) ||
        (row.kind === "phone_line" && !known.phone);
      // Voice notePlatformOpsDegrade already mails speech and reasoning.
      const voiceOwnsMail = row.kind === "speech" || row.kind === "reasoning";
      return signal({
        kind: row.kind,
        active: holdRow ? false : row.active,
        detail: row.detail,
        hold: holdRow,
        mail: !voiceOwnsMail,
        recoverMail: !voiceOwnsMail,
      });
    });
}

export function positiveNumber(raw: string | null | undefined, fallback: number): number {
  if (raw == null || String(raw).trim() === "") return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}
