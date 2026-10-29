/**
 * Settings › Identity › Your business: one "What you do" question.
 *
 * It writes the same two fields as before, each through its existing save:
 * tenants.vertical (the pack Voice and Brain read, via the settings save) and
 * tenants.business_category (the typed taxonomy, via saveBusinessCategoryAction).
 * A choice value is "<vertical>:<category>"; category may be empty.
 */
import { BUSINESS_TYPES, categoriesFor } from "./structuredData.ts";
import { resolveBusinessType } from "./businessType.ts";
import { VERTICAL_LABELS, parseVertical, type BusinessVertical } from "./vertical.ts";

export type IdentityCategoryChoice = {
  value: string;
  label: string;
  /** The pack, shown under the label. */
  detail: string;
  vertical: BusinessVertical;
  category: string;
};

/** Taxonomy business type for a stored vertical (hospitality has no categories: general). */
export function businessTypeForVertical(vertical: BusinessVertical): "retail" | "home_services" | "general" {
  return resolveBusinessType({ vertical });
}

export function categoryChoiceValue(vertical: BusinessVertical, category: string | null | undefined): string {
  return `${vertical}:${String(category || "").trim()}`;
}

export function parseCategoryChoice(value: string): { vertical: BusinessVertical; category: string } {
  const [v, c = ""] = String(value || "").split(":");
  return { vertical: parseVertical(v), category: c.trim() };
}

/**
 * Every category under its pack. "Other business" stays one row. A legacy
 * pack (hospitality) keeps its own row while it is the stored one.
 */
export function identityCategoryChoices(current: BusinessVertical): IdentityCategoryChoice[] {
  const out: IdentityCategoryChoice[] = [];
  for (const type of BUSINESS_TYPES) {
    const vertical = parseVertical(type.id);
    const packLabel = type.id === "general" ? "Other business" : VERTICAL_LABELS[vertical];
    if (type.id === "general") {
      out.push({ value: categoryChoiceValue("general", "other"), label: "Other business", detail: "", vertical: "general", category: "other" });
      continue;
    }
    for (const cat of type.categories) {
      out.push({ value: categoryChoiceValue(vertical, cat.id), label: cat.label, detail: packLabel, vertical, category: cat.id });
    }
  }
  if (current === "hospitality") {
    out.push({ value: categoryChoiceValue("hospitality", ""), label: VERTICAL_LABELS.hospitality, detail: "", vertical: "hospitality", category: "" });
  }
  return out;
}

/**
 * The choice to show for what is stored. A category that does not belong to the
 * stored pack is ignored (the pack wins, since Voice and Brain read it).
 */
export function currentCategoryChoice(vertical: BusinessVertical, category: string | null | undefined): string {
  const cat = String(category || "").trim();
  if (vertical === "hospitality") return categoryChoiceValue("hospitality", "");
  const type = businessTypeForVertical(vertical);
  if (type === "general") return categoryChoiceValue("general", "other");
  if (cat && categoriesFor(type).some((c) => c.id === cat)) return categoryChoiceValue(vertical, cat);
  return "";
}

/** What the business card must write for a pick. Category is written only when the taxonomy has it. */
export function categoryWrites(
  pick: string,
  stored: { vertical: BusinessVertical; category: string | null | undefined }
): { vertical: BusinessVertical; category: string | null; verticalChanged: boolean; categoryChanged: boolean } {
  const { vertical, category } = parseCategoryChoice(pick);
  const type = businessTypeForVertical(vertical);
  const valid = category && categoriesFor(type).some((c) => c.id === category) ? category : null;
  return {
    vertical,
    category: valid,
    verticalChanged: vertical !== stored.vertical,
    categoryChanged: valid !== null && valid !== String(stored.category || "").trim(),
  };
}
