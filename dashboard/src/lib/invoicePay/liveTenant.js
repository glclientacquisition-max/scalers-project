/* eslint-disable @typescript-eslint/no-require-imports -- node:test loads this file with require() */
const path = require("node:path");

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
 * Read billing_live_tenant_allowed. A missing key or a database error throws.
 * The caller fails closed. A production URL is read. Sandbox still refuses
 * that database in assertBachsAllowed. This does not write.
 * @param {string} tenantId
 * @param {NodeJS.ProcessEnv} env
 * @param {{ rpc?: (tenantId: string) => Promise<{ data: unknown, error: unknown }> }} [deps]
 */
function publicSupabaseUrlName() {
  return ["NEXT", "PUBLIC", "SUPABASE", "URL"].join("_");
}

async function readBillingLiveTenant(tenantId, env, deps = {}) {
  const source = env || {};
  const publicUrl = publicSupabaseUrlName();
  // Checkout passes a copied env. Next omits hosting secrets this file did
  // not read itself, so the copy can lack the service role. A missing key
  // used to refuse the business before Bachs was called.
  const url = String(
    source.SUPABASE_URL ||
      source[publicUrl] ||
      process.env.SUPABASE_URL ||
      process.env[publicUrl] ||
      ""
  );
  const key = String(source.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "");
  if (!url || !key) {
    const err = new Error("live tenant read failed");
    err.code = "bachs_live_refused";
    throw err;
  }
  const rpc = typeof deps.rpc === "function" ? deps.rpc : async (id) => {
    const { createClient } = loadSupabase();
    const admin = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    return admin.rpc("billing_live_tenant_allowed", { p_tenant_id: id });
  };
  const { data, error } = await rpc(String(tenantId || "").trim());
  if (error) {
    const err = new Error("live tenant read failed");
    err.code = "bachs_live_refused";
    throw err;
  }
  return data === true;
}

module.exports = { readBillingLiveTenant };
