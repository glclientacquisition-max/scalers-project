#!/usr/bin/env node
/**
 * Point scalers-staging.vercel.app at the READY deploy of the staging branch.
 * A preview deploy does not take that hostname. This runs after the branch rebuild.
 * It never assigns a production desk host.
 */
const fs = require("node:fs");

const STAGING_PROJECT_ID = "prj_koYxAaXjOZ9QYA7hVB2SUOEAmyoB";
const STAGING_TEAM_ID = "team_pZLbtKTricc6PI2UG9KutoFN";
const STAGING_ALIAS = "scalers-staging.vercel.app";
const STAGING_BRANCH = "cursor/staging-voice-468b";
const PRODUCTION_DESK_PROJECT_ID = "prj_GYOgX3yjVowvQ1hd7D1c0AWOovpx";
const PRODUCTION_DESK_HOSTS = new Set([
  "scalers.co.ke",
  "www.scalers.co.ke",
  "admin.scalers.co.ke",
  "scalers-project.vercel.app",
]);

const IGNORE_MAIN =
  'if [ "$VERCEL_GIT_COMMIT_REF" = "main" ]; then exit 0; else exit 1; fi';

function stagingProjectPinBody() {
  return {
    autoAssignCustomDomains: false,
    commandForIgnoringBuildStep: IGNORE_MAIN,
  };
}

function assertStagingTarget({ projectId, alias, branch }) {
  if (!projectId || projectId === PRODUCTION_DESK_PROJECT_ID) {
    throw new Error("Refusing: project is production desk");
  }
  if (projectId !== STAGING_PROJECT_ID) {
    throw new Error("Refusing: project is not scalers-staging");
  }
  if (PRODUCTION_DESK_HOSTS.has(alias) || alias !== STAGING_ALIAS) {
    throw new Error("Refusing: alias is not scalers-staging.vercel.app");
  }
  if (branch !== STAGING_BRANCH) {
    throw new Error("Refusing: branch is not the staging branch");
  }
}

function pickReadyDeployment(deployments, { sha, branch, projectId }) {
  assertStagingTarget({ projectId, alias: STAGING_ALIAS, branch });
  if (!sha || !/^[0-9a-f]{40}$/i.test(sha)) {
    throw new Error("Refusing: staging sha is missing");
  }
  const ready = (deployments || [])
    .filter((deployment) => {
      const meta = deployment?.meta || {};
      const state = deployment.readyState || deployment.state;
      const owner = deployment.projectId || deployment.project?.id || projectId;
      return (
        owner === projectId &&
        owner !== PRODUCTION_DESK_PROJECT_ID &&
        meta.githubCommitRef === branch &&
        meta.githubCommitSha === sha &&
        state === "READY"
      );
    })
    .sort((a, b) => (b.createdAt || b.created || 0) - (a.createdAt || a.created || 0));
  return ready[0] || null;
}

function deploymentId(deployment) {
  return deployment?.uid || deployment?.id || "";
}

function confirmedMeta(payload) {
  const deployment = payload?.deployment || payload || {};
  return {
    sha: deployment?.meta?.githubCommitSha || "",
    ref: deployment?.meta?.githubCommitRef || "",
    projectId: deployment?.projectId || deployment?.project?.id || "",
  };
}

async function vercel(fetchImpl, token, path, { method = "GET", body } = {}) {
  const response = await fetchImpl(`https://api.vercel.com${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let payload = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
  }
  if (!response.ok) {
    const message = payload?.error?.message || `Vercel ${method} failed (${response.status})`;
    throw new Error(message);
  }
  return payload;
}

function teamQuery(teamId) {
  return `teamId=${encodeURIComponent(teamId)}`;
}

async function assignStagingDesk({
  token,
  sha,
  fetchImpl = fetch,
  teamId = STAGING_TEAM_ID,
  projectId = STAGING_PROJECT_ID,
  branch = STAGING_BRANCH,
  alias = STAGING_ALIAS,
  timeoutMs = 12 * 60 * 1000,
  intervalMs = 15 * 1000,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now = Date.now,
}) {
  if (!token) {
    throw new Error(
      "VERCEL_TOKEN is not set. scalers-staging.vercel.app will stay on its current deploy."
    );
  }
  assertStagingTarget({ projectId, alias, branch });
  await vercel(fetchImpl, token, `/v9/projects/${projectId}?${teamQuery(teamId)}`, {
    method: "PATCH",
    body: stagingProjectPinBody(),
  });

  const deadline = now() + timeoutMs;
  let ready = null;
  for (;;) {
    const listed = await vercel(
      fetchImpl,
      token,
      `/v6/deployments?${teamQuery(teamId)}&projectId=${encodeURIComponent(projectId)}&sha=${encodeURIComponent(sha)}&limit=20`
    );
    ready = pickReadyDeployment(listed?.deployments || [], { sha, branch, projectId });
    if (ready) break;
    if (now() >= deadline) {
      throw new Error(`No READY deployment of ${sha} on scalers-staging`);
    }
    await sleep(intervalMs);
  }

  const id = deploymentId(ready);
  if (!id) throw new Error("READY deployment has no id");
  await vercel(fetchImpl, token, `/v2/deployments/${id}/aliases?${teamQuery(teamId)}`, {
    method: "POST",
    body: { alias },
  });

  const confirmed = confirmedMeta(
    await vercel(fetchImpl, token, `/v13/deployments/${encodeURIComponent(alias)}?${teamQuery(teamId)}`)
  );
  if (confirmed.projectId && confirmed.projectId !== projectId) {
    throw new Error("Refusing: alias resolved to a different project");
  }
  if (confirmed.sha !== sha || confirmed.ref !== branch) {
    throw new Error(`Alias ${alias} is on ${confirmed.ref || "unknown"} ${confirmed.sha || "unknown"}`);
  }
  return { deploymentId: id, sha, alias };
}

function readStagingSha(resultPath) {
  if (!resultPath || !fs.existsSync(resultPath)) return "";
  const result = JSON.parse(fs.readFileSync(resultPath, "utf8"));
  return typeof result.stagingSha === "string" ? result.stagingSha : "";
}

async function main() {
  const sha = process.env.STAGING_SHA || readStagingSha(process.env.STAGE_RESULT_PATH);
  if (!sha) throw new Error("Staging sha is missing");
  const assigned = await assignStagingDesk({ token: process.env.VERCEL_TOKEN, sha });
  console.log(
    `staging_desk_alias=${assigned.alias} sha=${assigned.sha} deployment=${assigned.deploymentId}`
  );
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message || error);
    process.exitCode = 1;
  });
}

module.exports = {
  STAGING_ALIAS,
  STAGING_BRANCH,
  STAGING_PROJECT_ID,
  PRODUCTION_DESK_PROJECT_ID,
  stagingProjectPinBody,
  assertStagingTarget,
  pickReadyDeployment,
  assignStagingDesk,
  readStagingSha,
};
