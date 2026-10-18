'use strict';
// Lookup latency gate. Warm-up samples are excluded by the caller.
// A slow outlier may lift p95 a little; a real regression lifts the median
// or pulls p95 far above the median from the same run.

function summarizeLatency(samples) {
  const sorted = [...samples].filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  if (!sorted.length) return { median: 0, p95: 0, cap: 80, ok: true };
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  const p95 = sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)];
  const cap = Math.max(80, median * 4);
  return { median, p95, cap, ok: median <= 40 && p95 <= cap };
}

module.exports = { summarizeLatency };
