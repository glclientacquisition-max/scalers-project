/* eslint-disable @typescript-eslint/no-require-imports -- node:test loads this file with require() */
const path = require("node:path");
const { PROD_REF } = require("./provider");

function loadSupabase() {
  try {
    return require("@supabase/supabase-js");
  } catch {
    return require(require.resolve("@supabase/supabase-js", {
      paths: [path.join(__dirname, "../../..")],
    }));
  }
}

/**
 * Read billing_live_tenant_allowed. A missing key, a production URL, or a
 * database error throws. The caller fails closed. This does not write.
 * @param {string} tenantId
 * @param {NodeJS.ProcessEnv} env
 */
async function readBillingLiveTenant(tenantId, env) {
  const source = env || {};
  const url = String(source.SUPABASE_URL || source.NEXT_PUBLIC_SUPABASE_URL || "");
  const key = String(source.SUPABASE_SERVICE_ROLE_KEY || "");
  if (!url || !key) {
    const err = new Error("live tenant read failed");
    err.code = "bachs_live_refused";
    throw err;
  }
  if (url.includes(PROD_REF)) {
    const err = new Error("refusing production database");
    err.code = "prod_refused";
    throw err;
  }
  const { createClient } = loadSupabase();
  const admin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await admin.rpc("billing_live_tenant_allowed", {
    p_tenant_id: tenantId,
  });
  if (error) {
    const err = new Error("live tenant read failed");
    err.code = "bachs_live_refused";
    throw err;
  }
  return data === true;
}

module.exports = { readBillingLiveTenant };
