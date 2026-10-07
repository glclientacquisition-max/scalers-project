/* eslint-disable @typescript-eslint/no-require-imports */
// Pure Quality rollup. Scores are the numbers Voice stored on call rows.
// Release keys prefer release.gitSha on the call row. An empty git SHA
// falls back to the Africa/Nairobi calendar day.

const FAILURE_RANK = [
  "silence",
  "deletedAnswer",
  "languageMismatch",
  "incomplete",
  "repeatedQuestion",
  "respelling",
  "prematureTurn",
  "slow",
];

const NAIROBI_OFFSET_MS = 3 * 60 * 60 * 1000;
const DROP_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const DROP_POINTS = 10;
const DROP_MIN_CALLS = 5;
const NEW_CHECK_CALLS = 3;

function round1(value) {
  return Math.round((value + Number.EPSILON) * 10) / 10;
}

function meanScore(scores) {
  const nums = scores.filter((score) => typeof score === "number" && Number.isFinite(score));
  if (!nums.length) return null;
  return round1(nums.reduce((sum, score) => sum + score, 0) / nums.length);
}

function firstText(...values) {
  for (const value of values) {
    if (value == null || typeof value === "object") continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return "";
}

function releaseFields(release) {
  const body = release && typeof release === "object" ? release : {};
  return {
    gitSha: firstText(body.gitSha, body.git_sha) || null,
    branch: firstText(body.branch) || null,
    label: firstText(body.label) || null,
  };
}

function nairobiDay(iso) {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return "unknown";
  return new Date(ms + NAIROBI_OFFSET_MS).toISOString().slice(0, 10);
}

function releaseKeyFromCall(payload, createdAt) {
  const body = payload && typeof payload === "object" ? payload : {};
  const fromRelease = releaseFields(body.release);
  if (fromRelease.gitSha) {
    return { key: fromRelease.gitSha, source: "release", ...fromRelease };
  }
  if (fromRelease.label) {
    return { key: fromRelease.label, source: "release", ...fromRelease };
  }
  const stages = Array.isArray(body.stages) ? body.stages : [];
  let stageKey = "";
  for (const stage of stages) {
    if (!stage || typeof stage !== "object") continue;
    stageKey = firstText(stage.gitSha, stage.git_sha, stage.releaseId, stage.release_id);
    if (!stageKey && stage.stage === "release") stageKey = firstText(stage.value, stage.id, stage.key);
    if (stageKey) break;
  }
  const deploy = body.deploy && typeof body.deploy === "object" ? body.deploy : {};
  const legacy = firstText(body.gitSha, body.git_sha, body.releaseId, body.release_id, deploy.gitSha, stageKey);
  if (legacy) {
    return { key: legacy, source: "payload", gitSha: legacy, branch: fromRelease.branch, label: fromRelease.label };
  }
  return { key: nairobiDay(createdAt), source: "day", gitSha: null, branch: null, label: null };
}

function topFailureFromChecks(checks) {
  if (!checks) return null;
  let best = null;
  let bestCount = 0;
  for (const check of FAILURE_RANK) {
    const count = Number(checks[check] || 0);
    if (count > bestCount) {
      best = check;
      bestCount = count;
    }
  }
  return best ? { check: best, count: bestCount } : null;
}

function sumChecks(calls) {
  const totals = {};
  for (const call of calls) {
    for (const [key, count] of Object.entries(call.checks || {})) {
      totals[key] = (totals[key] || 0) + Number(count || 0);
    }
  }
  return totals;
}

function trendDirection(trend) {
  if (trend == null) return "unknown";
  if (trend > 0) return "up";
  if (trend < 0) return "down";
  return "flat";
}

function callsInWindow(calls, start, end, endInclusive) {
  return calls.filter((call) => call.at >= start && (endInclusive ? call.at <= end : call.at < end));
}

function callsHitting(calls, check) {
  return calls.filter((call) => Number(call.checks?.[check] || 0) > 0).length;
}

function droppingFor(calls, nowMs) {
  const recent = callsInWindow(calls, nowMs - DROP_WINDOW_MS, nowMs, true);
  const prior = callsInWindow(calls, nowMs - 2 * DROP_WINDOW_MS, nowMs - DROP_WINDOW_MS, false);
  const reasons = [];
  if (recent.length >= DROP_MIN_CALLS && prior.length >= DROP_MIN_CALLS) {
    const current = meanScore(recent.map((call) => call.score));
    const previous = meanScore(prior.map((call) => call.score));
    const fell = current != null && previous != null ? round1(previous - current) : null;
    if (fell != null && fell >= DROP_POINTS) {
      reasons.push(`Average fell ${fell} points versus the prior 7 days.`);
    }
  }
  for (const check of FAILURE_RANK) {
    if (callsHitting(prior, check) > 0) continue;
    const hits = callsHitting(recent, check);
    if (hits >= NEW_CHECK_CALLS) {
      reasons.push(`${check} showed up on ${hits} calls and was absent in the prior 7 days.`);
    }
  }
  return {
    dropping: reasons.length > 0,
    droppingReason: reasons.length ? reasons.join(" ") : null,
  };
}

function rollupReleases(calls) {
  const groups = new Map();
  for (const call of calls) {
    const key = call.release?.key || "unknown";
    const source =
      call.release?.source === "release" || call.release?.source === "payload" ? call.release.source : "day";
    let group = groups.get(key);
    if (!group) {
      group = {
        key,
        source,
        gitSha: call.release?.gitSha || null,
        branch: call.release?.branch || null,
        label: call.release?.label || null,
        scores: [],
        at: call.at,
      };
      groups.set(key, group);
    }
    if (!group.gitSha && call.release?.gitSha) group.gitSha = call.release.gitSha;
    if (!group.branch && call.release?.branch) group.branch = call.release.branch;
    if (!group.label && call.release?.label) group.label = call.release.label;
    if (typeof call.score === "number") group.scores.push(call.score);
    if (call.at < group.at) group.at = call.at;
  }
  const ordered = [...groups.values()].sort((a, b) => a.at - b.at || a.key.localeCompare(b.key));
  let previous = null;
  return ordered.map((group) => {
    const score = meanScore(group.scores);
    const delta = previous == null || score == null ? null : round1(score - previous);
    previous = score;
    return {
      key: group.key,
      source: group.source,
      gitSha: group.gitSha,
      branch: group.branch,
      label: group.label,
      score,
      delta,
      callCount: group.scores.length,
    };
  });
}

function listReleaseDeltas(calls) {
  return rollupReleases(calls);
}

function rollupBusiness(calls, nowMs, windowMs) {
  const recentStart = nowMs - windowMs;
  const priorStart = nowMs - 2 * windowMs;
  const recent = calls.filter((call) => call.at >= recentStart && call.at <= nowMs);
  const prior = calls.filter((call) => call.at >= priorStart && call.at < recentStart);
  const currentScore = meanScore(recent.map((call) => call.score));
  const priorScore = meanScore(prior.map((call) => call.score));
  const trend = currentScore == null || priorScore == null ? null : round1(currentScore - priorScore);
  const drop = droppingFor(calls, nowMs);
  return {
    businessId: calls.find((call) => call.tenantId)?.tenantId || null,
    currentScore,
    priorScore,
    trend,
    trendDirection: trendDirection(trend),
    dropping: drop.dropping,
    droppingReason: drop.droppingReason,
    topFailure: topFailureFromChecks(sumChecks(recent)),
    callCount: recent.length,
    priorCallCount: prior.length,
    releases: rollupReleases(calls),
  };
}

function rollupBusinesses(calls, nowMs, windowMs) {
  const byTenant = new Map();
  for (const call of calls) {
    if (!call.tenantId) continue;
    const list = byTenant.get(call.tenantId) || [];
    list.push(call);
    byTenant.set(call.tenantId, list);
  }
  return [...byTenant.keys()].sort().map((tenantId) => rollupBusiness(byTenant.get(tenantId), nowMs, windowMs));
}

module.exports = {
  FAILURE_RANK,
  meanScore,
  releaseKeyFromCall,
  topFailureFromChecks,
  rollupReleases,
  listReleaseDeltas,
  droppingFor,
  rollupBusiness,
  rollupBusinesses,
};
