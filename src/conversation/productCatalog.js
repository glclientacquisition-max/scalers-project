// Product catalogue helpers for live ground truth (voice).

function asArray(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function normalizeInStock(raw) {
  const stockRaw = String(raw ?? '')
    .trim()
    .toLowerCase();
  if (['yes', 'true', '1', 'in_stock', 'available'].includes(stockRaw)) {
    return 'yes';
  }
  if (
    ['no', 'false', '0', 'out', 'out_of_stock', 'unavailable'].includes(stockRaw)
  ) {
    return 'no';
  }
  if (['unknown', 'maybe', '?'].includes(stockRaw)) return 'unknown';
  return '';
}

/** Soft cap for overview / untargeted inject. */
const LIVE_INJECT_MAX = 100;
/** Per-turn targeted matches shown to the model. */
const TARGETED_INJECT_MAX = 12;
/** Short sample list in the overview block. */
const OVERVIEW_SAMPLE_MAX = 8;

function normalizeProducts(raw) {
  return asArray(raw)
    .map((row) => {
      const aliasesRaw = row?.aliases ?? row?.alias;
      let aliases = [];
      if (Array.isArray(aliasesRaw)) {
        aliases = aliasesRaw.map((a) => String(a || '').trim()).filter(Boolean);
      } else if (aliasesRaw) {
        aliases = String(aliasesRaw)
          .split(/[,;|]/)
          .map((a) => a.trim())
          .filter(Boolean);
      }
      return {
        name: String(row?.name || '').trim(),
        sku: String(row?.sku || '').trim(),
        category: String(row?.category || '').trim(),
        price: String(row?.price || row?.price_range || row?.priceRange || '').trim(),
        unit: String(row?.unit || '').trim(),
        in_stock: normalizeInStock(row?.in_stock ?? row?.inStock),
        notes: String(row?.notes || '').trim(),
        aliases: aliases.slice(0, 8),
      };
    })
    .filter((row) => row.name);
}

function normalizeMatchText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}+\s:'’-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenize(value) {
  return normalizeMatchText(value)
    .split(' ')
    .filter((t) => t.length >= 3 && !['the', 'and', 'for', 'with', 'book', 'books'].includes(t));
}

function formatProductLine(p, index) {
  const bits = [`${index}. ${p.name}`];
  if (p.category) bits.push(`Category: ${p.category}`);
  if (p.sku) bits.push(`SKU: ${p.sku}`);
  bits.push(
    p.price
      ? `Price: ${p.price}`
      : 'Price: unknown (do not invent a number — say you do not have the exact price)'
  );
  if (p.unit) bits.push(`Unit: ${p.unit}`);
  if (p.in_stock) bits.push(`In stock: ${p.in_stock}`);
  if (p.aliases.length) bits.push(`Also called: ${p.aliases.join(', ')}`);
  if (p.notes) bits.push(`Notes: ${p.notes}`);
  return bits.join(' | ');
}

/**
 * Compact overview for the base LIVE GROUND TRUTH (not the full 500 dump).
 * Matching titles are injected per turn via selectProductsForTurn.
 */
function formatProductsOverview(products) {
  const all = normalizeProducts(products);
  if (!all.length) return '(none listed)';

  const categories = [
    ...new Set(all.map((p) => p.category).filter(Boolean)),
  ].slice(0, 12);
  const sample = all.slice(0, OVERVIEW_SAMPLE_MAX);
  const lines = [
    `${all.length} titles on file` +
      (categories.length ? ` across: ${categories.join(', ')}` : '') +
      '.',
    'Do NOT invent stock or prices. Matching titles for this turn appear under TARGETED PRODUCT MATCHES (authoritative for price/stock).',
    'Sample titles:',
    ...sample.map((p, i) => formatProductLine(p, i + 1)),
  ];
  if (all.length > sample.length) {
    lines.push(
      `(…${all.length - sample.length} more on file — ask for the exact title; targeted matches load when the caller names one)`
    );
  }
  lines.push(
    'PRICE RULE: Speak a money amount only when Price is a concrete value on a matched title. If Price is unknown, admit you do not have the exact price and offer a quote/enquiry — never guess KSh amounts.'
  );
  return lines.join('\n');
}

/** Legacy full-block formatter (tests / compilers). Caps at LIVE_INJECT_MAX. */
function formatProductsBlock(products) {
  const all = normalizeProducts(products);
  const rows = all.slice(0, LIVE_INJECT_MAX);
  if (!rows.length) return '(none listed)';
  const lines = rows.map((p, i) => formatProductLine(p, i + 1));
  if (all.length > rows.length) {
    lines.push(
      `(…${all.length - rows.length} more products on file — ask for the exact title; if missing, log an enquiry)`
    );
  }
  lines.push(
    'PRICE RULE: Speak a money amount only when Price is a concrete value above. If Price is unknown, admit you do not have the exact price and offer a quote/enquiry — never guess KSh amounts.'
  );
  return lines.join('\n');
}

/**
 * Find a catalogue product for a hold/order item string.
 * @returns {{product: object, matched: string, score: number}|null}
 */
function findProductMatch(item, rawCatalog) {
  const needle = normalizeMatchText(item);
  if (!needle || needle.length < 2) return null;
  const products = normalizeProducts(rawCatalog);
  let best = null;
  for (const product of products) {
    const terms = [product.name, product.sku, ...product.aliases].filter(Boolean);
    for (const term of terms) {
      const hay = normalizeMatchText(term);
      if (!hay) continue;
      let score = 0;
      if (hay === needle) score = 1000 + hay.length;
      else if (hay.includes(needle) || needle.includes(hay)) {
        const shorter = Math.min(hay.length, needle.length);
        const longer = Math.max(hay.length, needle.length);
        if (shorter < 4 && longer > shorter + 2) continue;
        if (shorter / longer < 0.5) continue;
        score = 100 + shorter;
      } else {
        continue;
      }
      if (!best || score > best.score) {
        best = { product, matched: term, score };
      }
    }
  }
  return best;
}

function entityValue(raw) {
  if (raw && typeof raw === 'object' && 'value' in raw) {
    return String(raw.value || '').trim();
  }
  return String(raw || '').trim();
}

/**
 * Score catalogue rows against the current caller turn + known entities.
 * Returns the best matches (may be empty).
 */
function selectProductsForTurn({
  catalog,
  queryText = '',
  entities = {},
  intent = '',
  limit = TARGETED_INJECT_MAX,
} = {}) {
  const products = normalizeProducts(catalog);
  if (!products.length) return [];

  const query = normalizeMatchText(queryText);
  const subject = normalizeMatchText(
    entityValue(entities.product) ||
      entityValue(entities.requestedItem) ||
      entityValue(entities.service) ||
      ''
  );
  const tokens = new Set([...tokenize(query), ...tokenize(subject)]);
  const intentKey = String(intent || '').toLowerCase();
  const productish = [
    'price',
    'availability',
    'hold',
    'hold_or_pickup',
    'order',
    'order_enquiry',
    'product_inquiry',
    'general_enquiry',
  ].includes(intentKey);

  const scored = [];
  for (const product of products) {
    const name = normalizeMatchText(product.name);
    const category = normalizeMatchText(product.category);
    const aliasHay = product.aliases.map(normalizeMatchText).join(' ');
    let score = 0;

    if (subject && (name === subject || aliasHay.split(' ').includes(subject))) {
      score += 1000;
    } else if (subject && (name.includes(subject) || subject.includes(name))) {
      score += 600;
    }

    if (query && name && (query.includes(name) || name.includes(query))) {
      score += 400;
    }
    for (const alias of product.aliases) {
      const a = normalizeMatchText(alias);
      if (a && query.includes(a)) score += 350;
    }
    if (category && query.includes(category)) score += 120;

    for (const token of tokens) {
      if (name.includes(token)) score += 40;
      if (category.includes(token)) score += 25;
      if (aliasHay.includes(token)) score += 30;
    }

    // Genre asks like "children books" should surface that category.
    if (
      productish &&
      category &&
      (query.includes(category) ||
        (category.includes('children') && /\b(child|kids?|children)\b/.test(query)))
    ) {
      score += 80;
    }

    if (score > 0) scored.push({ product, score });
  }

  scored.sort((a, b) => b.score - a.score || a.product.name.localeCompare(b.product.name));
  const out = [];
  const seen = new Set();
  for (const row of scored) {
    const key = row.product.name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row.product);
    if (out.length >= limit) break;
  }
  return out;
}

function formatTargetedProductsForPrompt(products, { totalCatalogSize = 0 } = {}) {
  const rows = normalizeProducts(products);
  if (!rows.length) {
    return [
      'TARGETED PRODUCT MATCHES (this turn): (none matched)',
      'If the caller named a title not listed here, say it is not in the grounded sample and offer an enquiry/special-order quote — never invent price or stock.',
    ].join('\n');
  }
  const lines = [
    'TARGETED PRODUCT MATCHES (this turn — authoritative for these titles):',
    ...rows.map((p, i) => formatProductLine(p, i + 1)),
    'PRICE RULE: Speak money only from Price above. Unknown Price → admit unknown; offer quote/enquiry.',
  ];
  if (totalCatalogSize > rows.length) {
    lines.push(
      `(Catalogue has ${totalCatalogSize} titles; only the best matches for this turn are shown.)`
    );
  }
  return lines.join('\n');
}

module.exports = {
  normalizeProducts,
  formatProductsBlock,
  formatProductsOverview,
  formatTargetedProductsForPrompt,
  selectProductsForTurn,
  LIVE_INJECT_MAX,
  TARGETED_INJECT_MAX,
  OVERVIEW_SAMPLE_MAX,
  findProductMatch,
  normalizeMatchText,
};
