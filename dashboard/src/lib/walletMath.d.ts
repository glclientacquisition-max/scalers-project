export function isLiveTransferSummary(summary: unknown): boolean;

export function minutesFromCallRows(
  rows: { duration_seconds?: number | null; ai_processing_minutes?: number | null }[]
): { seconds: number; minutes: number };

export function splitCallMinutes(
  rows: {
    duration_seconds?: number | null;
    ai_processing_minutes?: number | null;
    summary?: unknown;
  }[]
): {
  inboundSeconds: number;
  transferSeconds: number;
  inboundMinutes: number;
  transferMinutes: number;
  seconds: number;
  minutes: number;
};

export function estimatedCallCostKes(
  inboundMinutes: number,
  transferMinutes: number,
  inboundRate: number,
  transferRate: number
): number;

export function runwayDaysAtPace(opts: {
  minutesThisMonth: number;
  dayOfMonth: number;
  balanceKes: number;
  spentKesThisMonth?: number;
  inboundRate?: number;
}): number | null;
