/** Stored sentinel: never delete recordings for this scope. */
export const RETENTION_NEVER = -1;
export const RETENTION_MIN_DAYS = 7;
export const RETENTION_MAX_DAYS = 365;
export const RETENTION_DEFAULT_DAYS = 30;

export type EffectiveRetention = number | "never";

export function envRetentionDays(): number {
  const n = Number(process.env.RECORDING_RETENTION_DAYS);
  if (!Number.isFinite(n)) return RETENTION_DEFAULT_DAYS;
  if (n < 0) return RETENTION_NEVER;
  if (n >= RETENTION_MIN_DAYS && n <= RETENTION_MAX_DAYS) return Math.floor(n);
  return RETENTION_DEFAULT_DAYS;
}

/** Parse admin/DB value. null = inherit. -1 = never. 7-365 = days. */
export function parseRetentionStored(raw: unknown): number | null {
  if (raw === undefined || raw === null) return null;
  if (raw === "never" || raw === "Never") return RETENTION_NEVER;
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n)) return null;
  if (n === RETENTION_NEVER) return RETENTION_NEVER;
  if (n >= RETENTION_MIN_DAYS && n <= RETENTION_MAX_DAYS) return n;
  return null;
}

export function resolveEffectiveRetentionDays(input: {
  tenantOverride?: unknown;
  platformDays?: unknown;
  envDays?: unknown;
}): EffectiveRetention {
  const tenant = parseRetentionStored(input.tenantOverride);
  if (tenant === RETENTION_NEVER) return "never";
  if (typeof tenant === "number") return tenant;

  const platform = parseRetentionStored(input.platformDays);
  if (platform === RETENTION_NEVER) return "never";
  if (typeof platform === "number") return platform;

  const env = parseRetentionStored(input.envDays ?? envRetentionDays());
  if (env === RETENTION_NEVER) return "never";
  if (typeof env === "number") return env;
  return RETENTION_DEFAULT_DAYS;
}

export function retentionShowsNote(effective: EffectiveRetention): boolean {
  return effective !== "never";
}

export function retentionNoteCopy(effective: EffectiveRetention): string | null {
  if (!retentionShowsNote(effective)) return null;
  return `Recordings are kept for ${effective} days.`;
}

export function retentionDeletedCopy(effective: EffectiveRetention): string | null {
  if (!retentionShowsNote(effective)) return null;
  return `Recording deleted after ${effective} days`;
}

/** Shortest retention window in use anywhere (for purge prefilter). null = no finite retention. */
export function minActiveRetentionDays(input: {
  platformDays?: unknown;
  overrides?: Map<string, unknown> | Record<string, unknown>;
  envDays?: unknown;
}): number | null {
  const candidates: number[] = [];
  const env = parseRetentionStored(input.envDays ?? envRetentionDays());
  if (typeof env === "number" && env !== RETENTION_NEVER) candidates.push(env);

  const platform = parseRetentionStored(input.platformDays);
  if (typeof platform === "number" && platform !== RETENTION_NEVER) candidates.push(platform);

  const map =
    input.overrides instanceof Map
      ? input.overrides
      : new Map(Object.entries(input.overrides || {}));
  for (const ov of map.values()) {
    const t = parseRetentionStored(ov);
    if (typeof t === "number" && t !== RETENTION_NEVER) candidates.push(t);
  }
  if (!candidates.length) return null;
  return Math.min(...candidates);
}

export function callEligibleForRetentionPurge(
  createdAt: unknown,
  effectiveDays: EffectiveRetention,
): boolean {
  if (effectiveDays === "never") return false;
  const cutoff = new Date(
    Date.now() - effectiveDays * 24 * 60 * 60 * 1000,
  ).toISOString();
  return String(createdAt || "") < cutoff;
}

export function effectiveRetentionForTenant(
  context: {
    platformDays: unknown;
    overrides: Map<string, unknown>;
    envDays?: unknown;
  },
  tenantId: string | null | undefined,
): EffectiveRetention {
  const override = tenantId ? context.overrides.get(String(tenantId)) : undefined;
  return resolveEffectiveRetentionDays({
    tenantOverride: override,
    platformDays: context.platformDays,
    envDays: context.envDays,
  });
}
