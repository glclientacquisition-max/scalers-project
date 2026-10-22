/**
 * Bachs appends ?checkout_id= even when the success URL already has a query.
 * That lands as return=1?checkout_id=... in one parameter. Read both shapes.
 * @param {{ return?: string, checkout_id?: string }} search
 */
function readPayReturn(search) {
  const checkout = String((search && search.checkout_id) || "").trim();
  const ret = String((search && search.return) || "");
  if (checkout) return { return: ret === "1" ? "1" : ret, checkout_id: checkout };
  const mashed = ret.match(/^1\?checkout_id=([^&#]+)/);
  if (mashed) {
    return { return: "1", checkout_id: decodeURIComponent(mashed[1]) };
  }
  return { return: ret, checkout_id: "" };
}

module.exports = { readPayReturn };
