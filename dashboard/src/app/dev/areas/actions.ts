"use server";

import type { AreaSaveResult } from "@/app/(desk)/settings/areas/actions";

/** Dev harness save: writes nothing. 404s outside DASHBOARD_OPEN like the page. */
export async function devSaveAreaPicksAction(_raw: unknown, confirm = false): Promise<AreaSaveResult> {
  if (process.env.DASHBOARD_OPEN !== "true") return { ok: false, error: "Not available." };
  return { ok: true, message: confirm ? "Areas checked and saved." : "Areas saved." };
}
