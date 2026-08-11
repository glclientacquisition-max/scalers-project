"use server";

import { revalidatePath } from "next/cache";
import { isAuthenticated } from "@/lib/auth";
import { createWorkspaceDataClient, getCurrentTenant } from "@/lib/tenant";
import { fetchPublicUrlSafe } from "@/lib/ingest/ssrfFetch";
import {
  htmlToPlainText,
  looksLikeClientRenderedShell,
  normalizePasteText,
} from "@/lib/ingest/sanitize";
import {
  mergeProductCatalog,
  normalizeProductCatalog,
  parseBulkProducts,
  parseProductCsv,
  PRODUCT_CATALOG_MAX,
  type ProductItem,
} from "@/lib/productCatalog";
import {
  normalizeSocialHandles,
  type SocialHandles,
} from "@/lib/socialHandles";
import { generateGeminiText } from "@/lib/gemini";

export type CatalogImportState = {
  error?: string;
  ok?: boolean;
  message?: string;
  products?: ProductItem[];
  social?: SocialHandles;
};

function extractJsonObject(text: string): unknown {
  const raw = String(text || "").trim();
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(raw.slice(start, end + 1));
      } catch {
        return {};
      }
    }
    return {};
  }
}

async function extractProductsFromText(
  sourceText: string
): Promise<{ products: ProductItem[]; social: SocialHandles }> {
  const localProducts = parseBulkProducts(sourceText);
  const channels: SocialHandles["channels"] = [];
  const ig = sourceText.match(/@[a-z0-9._]{2,40}/i)?.[0];
  if (ig) channels.push({ kind: "instagram", label: "Instagram", value: ig });
  const web = sourceText.match(/https?:\/\/[^\s\]]+/i)?.[0];
  if (web) channels.push({ kind: "website", label: "Website", value: web });
  const phones = sourceText.match(/(?:\+?254|0)\s*\d{2,3}[\s-]?\d{3}[\s-]?\d{3,4}/g) || [];
  phones.slice(0, 4).forEach((phone, i) => {
    channels.push({
      kind: i === 0 ? "whatsapp" : "phone",
      label: i === 0 ? "Main" : `Line ${i + 1}`,
      value: phone.replace(/\s+/g, " "),
    });
  });
  const social = normalizeSocialHandles({ channels });

  if (!process.env.GEMINI_API_KEY) {
    return { products: localProducts, social };
  }

  try {
    const raw = await generateGeminiText({
      systemInstruction: `Extract a product catalogue and public contact channels for a Kenyan shop phone receptionist.
Return ONLY JSON:
{"products":[{"name":"","price":"","category":"","in_stock":"yes|no|unknown|","sku":"","unit":"","notes":"","aliases":[]}],"social":{"channels":[{"kind":"phone|whatsapp|website|instagram|facebook|tiktok|twitter|youtube|email|other","label":"Main","value":""}]}}
Rules: products are individual sellable items (books, SKUs), NOT services like "delivery" or section headings. Include every distinct phone/WhatsApp found with a short label. Max ${PRODUCT_CATALOG_MAX} products. Empty arrays when unknown.`,
      userText: sourceText.slice(0, 18000),
      temperature: 0.2,
      maxOutputTokens: 4096,
      timeoutMs: 20_000,
    });
    const obj = extractJsonObject(raw) as Record<string, unknown>;
    const products = normalizeProductCatalog(obj.products).filter((p) => p.name);
    const gemSocial = normalizeSocialHandles(obj.social || {});
    const mergedChannels = normalizeSocialHandles({
      channels: [...social.channels, ...gemSocial.channels],
    });
    return {
      products: products.length ? products : localProducts,
      social: mergedChannels,
    };
  } catch {
    return { products: localProducts, social };
  }
}

export async function previewCatalogImportAction(
  _prev: CatalogImportState,
  formData: FormData
): Promise<CatalogImportState> {
  if (!(await isAuthenticated())) return { error: "Sign in to import." };
  const tenant = await getCurrentTenant();
  if (!tenant) return { error: "No workspace linked." };

  const tenantId = String(formData.get("tenant_id") || "").trim();
  if (!tenantId || tenantId !== tenant.id) return { error: "Forbidden." };

  const mode = String(formData.get("source_mode") || "paste").trim().toLowerCase();

  try {
    let sourceText = "";
    if (mode === "csv" || mode === "paste") {
      sourceText = normalizePasteText(String(formData.get("paste") || ""));
      if (sourceText.length < 3) {
        return { error: "Paste a product list or CSV first." };
      }
      // Prefer CSV parser when header-like or many commas
      const products =
        mode === "csv" || /,|\t|\|/.test(sourceText)
          ? parseProductCsv(sourceText)
          : parseBulkProducts(sourceText);
      if (!products.length) {
        return {
          error:
            "No product rows found. Use CSV headers like name,price,category,in_stock or one product per line.",
        };
      }
      const capped = products.length > PRODUCT_CATALOG_MAX;
      return {
        ok: true,
        products: products.slice(0, PRODUCT_CATALOG_MAX),
        message: capped
          ? `Found ${products.length} products — keeping the first ${PRODUCT_CATALOG_MAX}. Review below, then add.`
          : `Found ${products.length} products. Review below, then add.`,
      };
    }

    if (mode === "url") {
      const url = String(formData.get("url") || "").trim();
      const fetched = await fetchPublicUrlSafe(url);
      if (looksLikeClientRenderedShell(fetched.text)) {
        return {
          error:
            "This page builds in the browser. Paste a CSV export or product list instead.",
        };
      }
      sourceText = htmlToPlainText(fetched.text);
      if (sourceText.length < 40) {
        return { error: "Page had almost no text. Try a CSV export or paste." };
      }
      const { products, social } = await extractProductsFromText(sourceText);
      if (!products.length) {
        return {
          error:
            "Could not find product rows on that page. Paste a CSV from your shop admin instead.",
        };
      }
      return {
        ok: true,
        products: products.slice(0, PRODUCT_CATALOG_MAX),
        social,
        message: `Found ${Math.min(products.length, PRODUCT_CATALOG_MAX)} products from the page.`,
      };
    }

    return { error: "Pick paste, CSV, or website." };
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Could not read that source.",
    };
  }
}

export async function applyCatalogImportAction(
  _prev: CatalogImportState,
  formData: FormData
): Promise<CatalogImportState> {
  if (!(await isAuthenticated())) return { error: "Sign in to save." };
  const tenant = await getCurrentTenant();
  if (!tenant) return { error: "No workspace linked." };

  const tenantId = String(formData.get("tenant_id") || "").trim();
  if (!tenantId || tenantId !== tenant.id) return { error: "Forbidden." };

  let products: ProductItem[] = [];
  try {
    products = normalizeProductCatalog(
      JSON.parse(String(formData.get("products_json") || "[]"))
    ).filter((p) => p.name);
  } catch {
    return { error: "Draft expired. Scan again." };
  }
  if (!products.length) return { error: "No products selected." };

  const mode =
    String(formData.get("merge_mode") || "merge") === "replace"
      ? "replace"
      : "merge";
  const includeSocial = String(formData.get("include_social") || "") === "1";
  let social = normalizeSocialHandles(tenant.social_handles);
  if (includeSocial) {
    try {
      social = normalizeSocialHandles(
        JSON.parse(String(formData.get("social_json") || "{}"))
      );
    } catch {
      /* keep existing */
    }
  }

  const existing = normalizeProductCatalog(tenant.product_catalog);
  const merged = mergeProductCatalog(existing, products, mode);

  const workspace = await createWorkspaceDataClient();
  if (!workspace) return { error: "Not signed in." };

  const patch: Record<string, unknown> = {
    product_catalog: merged,
  };
  if (includeSocial) {
    patch.social_handles = social;
  }

  const { error } = await workspace.client
    .from("tenants")
    .update(patch)
    .eq("id", tenant.id);

  if (error) {
    if (/product_catalog|social_handles/i.test(error.message)) {
      return {
        error: `${error.message} Apply docs/supabase/product_catalog_and_social.sql in Supabase.`,
      };
    }
    return { error: error.message };
  }

  revalidatePath("/settings");
  return {
    ok: true,
    message: `Saved ${merged.length} product${merged.length === 1 ? "" : "s"} to your catalogue. Open Train to review.`,
  };
}
