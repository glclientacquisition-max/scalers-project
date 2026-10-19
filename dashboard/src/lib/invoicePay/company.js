const ISSUER_COLUMNS =
  "issuer_legal_name, issuer_product, issuer_phone, issuer_email, issuer_address, issuer_city, issuer_kra_pin";

function clean(value) {
  const text = value == null ? "" : String(value).trim();
  return text || null;
}

/**
 * Letterhead copied onto an invoice at issue time.
 * Null until issuer_legal_name is set, so a draft falls through to the live row.
 * @param {object | null | undefined} row
 */
function letterheadFromInvoice(row) {
  const legalName = clean(row && row.issuer_legal_name);
  if (!legalName) return null;
  return {
    legalName,
    product: clean(row.issuer_product) || "Business Assistant",
    phone: clean(row.issuer_phone),
    email: clean(row.issuer_email),
    address: clean(row.issuer_address),
    city: clean(row.issuer_city),
    kraPin: clean(row.issuer_kra_pin),
  };
}

/**
 * The live billing_company row. Blank address, city, and KRA PIN stay null.
 * @param {object | null | undefined} row
 */
function letterheadFromCompanyRow(row) {
  const legalName = clean(row && row.legal_name);
  if (!legalName) return null;
  return {
    legalName,
    product: clean(row.product) || "Business Assistant",
    phone: clean(row.phone),
    email: clean(row.email),
    address: clean(row.address),
    city: clean(row.city),
    kraPin: clean(row.kra_pin),
  };
}

/**
 * Issued invoices use the snapshot. A draft, or an invoice issued before the
 * snapshot columns existed, uses the current billing_company row.
 * A missing row returns null. The document then omits the letterhead lines.
 * The admin client is the service-role Supabase client. Typed loosely so the
 * Postgrest builder stays assignable from the generated client.
 * @param {any} admin
 * @param {object | null | undefined} row
 */
async function letterheadForInvoice(admin, row) {
  const snapped = letterheadFromInvoice(row);
  if (snapped) return snapped;
  if (!admin || typeof admin.from !== "function") return null;
  const result = await admin
    .from("billing_company")
    .select("legal_name, product, phone, email, address, city, kra_pin")
    .eq("id", 1)
    .maybeSingle();
  if (!result || result.error || !result.data) return null;
  return letterheadFromCompanyRow(result.data);
}

module.exports = {
  ISSUER_COLUMNS,
  letterheadFromInvoice,
  letterheadFromCompanyRow,
  letterheadForInvoice,
};
