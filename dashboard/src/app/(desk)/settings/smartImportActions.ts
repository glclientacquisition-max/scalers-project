"use server";

/**
 * Smart import (DESK_SMART_IMPORT). Read only: extracts and diffs against the saved business.
 * Writes happen through the existing save actions (see lib/smartImport/plan.ts).
 */
import { isAuthenticated } from "@/lib/auth";
import { memberDenied } from "@/lib/requireMember";
import { getCurrentTenant } from "@/lib/tenant";
import { smartImportEnabled } from "@/lib/smartImport/flag";
import { smartExtract } from "@/lib/smartImport/extract";
import { diffImport, type DiffRow, type SavedSettings } from "@/lib/smartImport/diffImport";
import type { PlanContext } from "@/lib/smartImport/plan";
import { savedSettingsFor } from "@/lib/smartImport/saved";
import { prepareImportFile, IMPORT_FILE_MAX_BYTES } from "@/lib/ingest/fileInput";
import { fetchPublicUrlSafe } from "@/lib/ingest/ssrfFetch";
import { htmlToPlainText, looksLikeClientRenderedShell, normalizePasteText } from "@/lib/ingest/sanitize";
import { parseVertical } from "@/lib/vertical";

export type SmartImportState = {
  error?: string;
  ok?: boolean;
  message?: string;
  rows?: DiffRow[];
  saved?: SavedSettings;
  ctx?: PlanContext;
  source?: "gemini" | "local" | "csv";
};

const hits = new Map<string, number[]>();
function limited(tenantId: string): boolean {
  const now = Date.now();
  const prev = (hits.get(tenantId) || []).filter((t) => now - t < 10 * 60 * 1000);
  if (prev.length >= 8) return true;
  prev.push(now);
  hits.set(tenantId, prev);
  return false;
}

export async function smartImportExtractAction(_prev: SmartImportState, formData: FormData): Promise<SmartImportState> {
  if (!smartImportEnabled()) return { error: "Import isn't switched on for this business yet." };
  const denied = await memberDenied("settings.edit");
  if (denied) return denied;
  if (!(await isAuthenticated())) return { error: "Sign in to import." };
  const tenant = await getCurrentTenant();
  if (!tenant) return { error: "No workspace linked to this account." };
  if (String(formData.get("tenant_id") || "") !== tenant.id) return { error: "Forbidden." };
  if (limited(tenant.id)) return { error: "You've imported a few times recently. Wait a few minutes and try again." };

  const retail = parseVertical(tenant.vertical) === "retail";
  const mode = String(formData.get("source_mode") || "paste");
  try {
    let label = "pasted text";
    let result;
    if (mode === "file") {
      const file = formData.get("file");
      if (!(file instanceof File) || !file.size) return { error: "Pick a photo, PDF or CSV first." };
      if (file.size > IMPORT_FILE_MAX_BYTES) return { error: "That file is over 10 MB. Send a smaller photo or split the PDF." };
      const prepared = prepareImportFile(file, new Uint8Array(await file.arrayBuffer()));
      if (!prepared.ok) return { error: prepared.error };
      label = prepared.label;
      result =
        prepared.kind === "csv"
          ? await smartExtract({ csvText: prepared.text, businessName: tenant.business_name, retail })
          : await smartExtract({ file: prepared.part, businessName: tenant.business_name, retail });
    } else if (mode === "url") {
      const fetched = await fetchPublicUrlSafe(String(formData.get("url") || "").trim());
      if (looksLikeClientRenderedShell(fetched.text)) {
        return { error: "This website builds its pages in the browser, so the link alone isn't enough. Paste the text or upload a screenshot instead." };
      }
      const text = htmlToPlainText(fetched.text);
      if (text.length < 40) return { error: "We opened the page but found almost no text. Paste it or upload a screenshot instead." };
      label = fetched.finalUrl;
      result = await smartExtract({ text, businessName: tenant.business_name, retail });
    } else {
      const text = normalizePasteText(String(formData.get("paste") || ""));
      if (text.length < 12) return { error: "Paste your menu, price list or business details first." };
      result = await smartExtract({ text, businessName: tenant.business_name, retail });
    }
    if (!result.items.length) {
      return { error: "We couldn't find prices, services or business details in that. Try a clearer photo or paste the text." };
    }
    const { saved, ctx } = savedSettingsFor(tenant);
    const rows = diffImport(result.items, saved);
    return {
      ok: true,
      rows,
      saved,
      ctx: { ...ctx, sourceLabel: `import:${mode}:${label}`.slice(0, 120) },
      source: result.source,
      message: result.note,
    };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not read that source." };
  }
}
