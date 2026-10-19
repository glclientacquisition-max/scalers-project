#!/usr/bin/env node
"use strict";

/**
 * Copy one published package version from the database in SUPABASE_URL
 * to another database in SUPABASE_URL.
 *
 * Export from staging, then import on the target. Import writes an audit row
 * and does not move subscribers.
 *
 * This script refuses the production project. Do not point it at production
 * until Alvin's go. This file does not run the import by itself.
 *
 *   node scripts/promote-package-version.js export --version-id <uuid> --out version.json
 *   node scripts/promote-package-version.js import --file version.json --actor <name> --reason <text>
 *
 * Environment (names only; do not commit values):
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   PACKAGE_VERSION_PROMOTE_ALLOW_PROD   set to yes only after Alvin's go
 */

const fs = require("fs");

const PROD_PROJECT_REF = "fjxcdccgyhnvnnlnovcl";

function promoteTargetRefusal(url, env = process.env) {
  if (!String(url || "").includes(PROD_PROJECT_REF)) return null;
  if (env.PACKAGE_VERSION_PROMOTE_ALLOW_PROD === "yes") return null;
  return "This script does not run against production. Promoting a package version there needs Alvin's go. This run does not do that.";
}

function projectRef(url) {
  const match = String(url || "").match(/https:\/\/([a-z0-9]+)\.supabase\.co/i);
  return match ? match[1] : null;
}

function readArgs(argv) {
  const parsed = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) {
      parsed._.push(token);
      continue;
    }
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      parsed[key] = true;
    } else {
      parsed[key] = next;
      i += 1;
    }
  }
  return parsed;
}

async function rpc(url, key, name, args) {
  const endpoint = `${String(url).replace(/\/+$/, "")}/rest/v1/rpc/${name}`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      apikey: key,
      authorization: `Bearer ${key}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(args),
  });
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { message: text };
  }
  if (!response.ok) {
    const message = (body && (body.message || body.error)) || response.statusText;
    throw new Error(String(message));
  }
  return body;
}

async function main() {
  const parsed = readArgs(process.argv.slice(2));
  const command = parsed._[0];
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const refusal = promoteTargetRefusal(url);
  if (refusal) {
    console.error(refusal);
    process.exit(2);
  }
  if (command !== "export" && command !== "import") {
    console.error("Usage: node scripts/promote-package-version.js export --version-id <uuid> --out <file>");
    console.error("       node scripts/promote-package-version.js import --file <file> --actor <name> --reason <text>");
    process.exit(1);
  }
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!url || !key) {
    console.error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the environment. Do not paste them into the command.");
    process.exit(1);
  }

  if (command === "export") {
    if (!parsed["version-id"] || !parsed.out) {
      console.error("Export needs --version-id and --out.");
      process.exit(1);
    }
    const payload = await rpc(url, key, "admin_export_package_version", {
      p_version_id: parsed["version-id"],
    });
    payload.source_project_ref = projectRef(url);
    fs.writeFileSync(parsed.out, `${JSON.stringify(payload, null, 2)}\n`);
    console.log(`Wrote ${parsed.out}`);
    return;
  }

  if (!parsed.file || !parsed.actor || !parsed.reason) {
    console.error("Import needs --file, --actor, and --reason.");
    process.exit(1);
  }
  const payload = JSON.parse(fs.readFileSync(parsed.file, "utf8"));
  const result = await rpc(url, key, "admin_import_promoted_package_version", {
    p_payload: payload,
    p_actor: parsed.actor,
    p_reason: parsed.reason,
  });
  console.log(JSON.stringify({
    version_id: result.version_id,
    already_present: result.already_present,
    sku: result.version && result.version.sku,
    version: result.version && result.version.version,
  }));
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err && err.message ? err.message : err);
    process.exit(1);
  });
}

module.exports = { promoteTargetRefusal, PROD_PROJECT_REF, projectRef };
