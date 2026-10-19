'use strict';

/** Owner-facing copy for lookup() status + reason. Never expose internal codes in Desk. */

const SAVE_ON = {
  price: 'Catalogue',
  prices: 'Catalogue',
  hours: 'Hours',
  fee: 'Locations',
  delivery: 'Locations',
  pay: 'Policies',
  payment: 'Policies',
};

function saveHint(kind) {
  const key = SAVE_ON[kind] || 'Settings';
  return key;
}

function ownerLookupReason(kind, result) {
  const status = String(result?.status || '');
  const code = String(result?.reason || '');
  const panel = saveHint(kind);

  if (status === 'found') return 'Ready on the next call.';

  if (code === 'hash_no_row' || code === 'hash_missing' || code === 'hash_mismatch') {
    if (kind === 'fee' || kind === 'delivery') {
      return 'Area fees are saved but not confirmed. Open Locations and save.';
    }
    if (kind === 'pay' || kind === 'payment') {
      return 'Payment details are saved but not confirmed. Open Policies and save.';
    }
    if (kind === 'price' || kind === 'prices') {
      return 'Catalogue prices are saved but not confirmed. Open Catalogue and save.';
    }
    if (kind === 'hours') {
      return 'Opening hours are saved but not confirmed. Open Hours and save.';
    }
    return `Saved details need a confirm. Open ${panel} and save.`;
  }

  if (code.startsWith('source_')) {
    return `Imported from your notes. Press Save on ${panel} to use it.`;
  }

  if (code === 'not_confirmed' || status === 'unconfirmed') {
    return `Imported from your notes. Press Save on ${panel} to use it.`;
  }

  if (status === 'ambiguous' || code === 'several_matches') {
    if (kind === 'price' || kind === 'prices') {
      return 'Several items match this question, so callers will be asked which one.';
    }
    return 'Several matches on file. Narrow the question or tidy the catalogue.';
  }

  if (kind === 'price' || kind === 'prices') {
    if (code === 'price_quote' || status === 'not_on_file') {
      return 'Price is ask for a quote, so it takes a message.';
    }
    return 'Add items and prices on Catalogue.';
  }

  if (kind === 'hours') return 'Add your opening hours.';

  if (kind === 'fee' || kind === 'delivery') {
    if (status === 'no_data' || code === 'no_list') return 'Add delivery areas on Locations.';
    if (status === 'not_found_in_list' || code === 'no_match') {
      return 'That area is not on your list yet. Add it on Locations.';
    }
    return 'Add delivery areas on Locations.';
  }

  if (kind === 'pay' || kind === 'payment') {
    if (status === 'no_data' || code === 'no_list' || status === 'not_on_file') {
      return 'No till number saved.';
    }
    if (status === 'not_found_in_list' || code === 'no_match') {
      return 'No matching payment number on file. Add it on Policies.';
    }
    return 'Add how customers pay on Policies.';
  }

  return 'Not added yet.';
}

/** Desk lookup preview: plain stamp and headline (never raw lookup status codes). */
function lookupPreviewPresentation(status) {
  const s = String(status || '');
  if (s === 'found') {
    return { headline: 'Will say', stampLabel: 'Will say', stampTone: 'ok', willSay: true };
  }
  if (s === 'ambiguous') {
    return {
      headline: 'Will ask which one',
      stampLabel: 'Will ask which one',
      stampTone: 'neutral',
      willSay: false,
    };
  }
  if (s === 'unconfirmed') {
    return {
      headline: "Won't say",
      stampLabel: 'Not confirmed yet',
      stampTone: 'attention',
      willSay: false,
    };
  }
  if (s === 'no_data') {
    return { headline: "Won't say", stampLabel: 'Missing', stampTone: 'attention', willSay: false };
  }
  return { headline: "Won't say", stampLabel: "Won't say", stampTone: 'attention', willSay: false };
}

/** Every reason code lookup() may attach (for guard tests). */
const LOOKUP_REASON_CODES = [
  'match',
  'not_speakable',
  'no_list',
  'no_match',
  'not_confirmed',
  'several_matches',
  'hash_no_row',
  'hash_missing',
  'hash_mismatch',
  'confirmed',
  'not_confirmed',
  'price_quote',
  'price_unknown',
  'price_unspoken',
];

module.exports = {
  ownerLookupReason,
  lookupPreviewPresentation,
  LOOKUP_REASON_CODES,
};
