#!/usr/bin/env node
/**
 * Backfill public.tenant_area_picks from legacy coverage (unconfirmed).
 * DRY RUN by default. --apply writes rows that do not exist yet.
 *
 *   node scripts/backfill-tenant-area-picks.mjs [--tenant <uuid>] [--apply]
 *
 * Needs SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY. Pick JSON uses
 * dashboard/src/lib/areaPicksMigrate.ts (fee/note merge from service_areas.areas).
 */
import { createClient } from "@supabase/supabase-js";
import { tenantAreaPicksFromLegacy } from "../dashboard/src/lib/areaPicksMigrate.ts";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const tenantIdx = args.indexOf("--tenant");
const tenantId = tenantIdx >= 0 ? args[tenantIdx + 1] : null;

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const db = createClient(url, key, { auth: { persistSession: false } });

let q = db.from("tenants").select("id, service_areas, business_policies");
if (tenantId) q = q.eq("id", tenantId);
const { data: rows, error } = await q;
if (error) throw new Error(error.message);

let would = 0;
let wrote = 0;
for (const row of rows || []) {
  const built = tenantAreaPicksFromLegacy({
    service_areas: row.service_areas,
    business_policies: row.business_policies,
  });
  if (!built.moved_from.length && !built.picks.picks.length) continue;

  const { data: existing } = await db.from("tenant_area_picks").select("tenant_id").eq("tenant_id", row.id).maybeSingle();
  if (existing) {
    console.log(`${row.id} skip (row exists)`);
    continue;
  }

  would++;
  const payload = {
    tenant_id: row.id,
    tree_version: built.tree_version,
    picks: built.picks,
    moved_from: built.moved_from,
    confirmed_at: null,
    updated_at: new Date().toISOString(),
  };
  if (!apply) {
    console.log(`${row.id} would insert (${built.picks.picks.length} picks, moved_from ${built.moved_from.length})`);
    continue;
  }
  const { error: insErr } = await db.from("tenant_area_picks").insert(payload);
  if (insErr) throw new Error(`${row.id}: ${insErr.message}`);
  wrote++;
  console.log(`${row.id} inserted`);
}

console.log(apply ? `Done. wrote=${wrote}` : `Dry run. would insert=${would} (pass --apply to write)`);
