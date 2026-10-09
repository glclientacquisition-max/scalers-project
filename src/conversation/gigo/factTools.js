// GIGO read-only Brain tools. Each tool reads owner-confirmed facts and
// returns a result plus, for an unknown, the exact line to speak.
//
// Declarations use the native function-call shape so the fresh #536 can
// register them once Voice #537 lands. Nothing here writes, notifies, or
// touches the socket. Today these run in code (no model round-trip).
//
// Caller name is not a tool here. It stays a code-held phone-file fact.

const { FACTS } = require('./factSchema');
const {
  readFact,
  lookupCatalogItem,
  checkCoverage,
  unknownFactLine,
} = require('./factReaders');

const SPEAKABLE_KEYS = Object.freeze(FACTS.filter((def) => def.speakable).map((def) => def.key));

const GIGO_FACT_TOOLS = Object.freeze([
  Object.freeze({
    name: 'read_business_fact',
    description:
      'Read one owner-confirmed business fact (hours, location, areas served, payment, policies, notice). Unknown means say you will confirm with the owner.',
    parameters: {
      type: 'object',
      properties: { key: { type: 'string', enum: SPEAKABLE_KEYS } },
      required: ['key'],
    },
  }),
  Object.freeze({
    name: 'lookup_catalog_item',
    description:
      'Find a listed product or service by name, with its confirmed price, stock, and lead time. Any unknown part must not be guessed.',
    parameters: {
      type: 'object',
      properties: { query: { type: 'string' } },
      required: ['query'],
    },
  }),
  Object.freeze({
    name: 'check_coverage',
    description: "Check a caller's place against the confirmed areas served.",
    parameters: {
      type: 'object',
      properties: { place: { type: 'string' } },
      required: ['place'],
    },
  }),
]);

function speakOpts(profile, opts = {}) {
  return { language: opts.language || 'en', afterHoursMode: profile.afterHoursMode };
}

/**
 * Run one GIGO read tool. Never throws. An unknown result always carries
 * `say`, the unknown line for this call's language and mode.
 * @param {string} name
 * @param {object} args
 * @param {object} profile  voice profile
 * @param {{ language?: string, now?: Date }} [opts]
 * @returns {{ ok: boolean, tool: string, status: string, value?: unknown, say?: string, reason?: string|null }}
 */
function runFactTool(name, args = {}, profileIn = {}, opts = {}) {
  const profile = profileIn && typeof profileIn === 'object' ? profileIn : {};
  const now = opts.now || new Date();
  try {
    if (name === 'read_business_fact') {
      const key = String(args?.key || '');
      if (!SPEAKABLE_KEYS.includes(key)) {
        return {
          ok: false,
          tool: name,
          status: 'unknown',
          reason: 'not_readable',
          say: unknownFactLine(speakOpts(profile, opts)),
        };
      }
      const r = readFact(profile, key, { now });
      if (r.status === 'known') return { ok: true, tool: name, status: 'known', value: r.value, reason: null };
      return {
        ok: true,
        tool: name,
        status: 'unknown',
        reason: r.reason,
        say: unknownFactLine({ ...speakOpts(profile, opts), topic: r.topic }),
      };
    }
    if (name === 'lookup_catalog_item') {
      const hit = lookupCatalogItem(profile, String(args?.query || ''), { now });
      if (hit.status !== 'found') {
        return {
          ok: true,
          tool: name,
          status: hit.status,
          reason: hit.reason,
          // not_listed is a confirmed answer; the playbook / unknown_answer_fallback
          // speaks it. unknown gets the confirm line.
          say: hit.status === 'unknown' ? unknownFactLine(speakOpts(profile, opts)) : undefined,
        };
      }
      const item = hit.item;
      const unknownParts = ['price', 'in_stock', 'lead_time'].filter(
        (leaf) => !(item.kind === 'service' && leaf === 'in_stock') && item[leaf].status !== 'known'
      );
      return {
        ok: true,
        tool: name,
        status: 'found',
        reason: null,
        value: {
          kind: item.kind,
          name: item.name,
          price: item.price.status === 'known' ? item.price.value : null,
          in_stock: item.kind === 'product' && item.in_stock.status === 'known' ? item.in_stock.value : null,
          lead_time: item.lead_time.status === 'known' ? item.lead_time.value : null,
          unknown: unknownParts,
        },
        say: unknownParts.length
          ? Object.fromEntries(
              unknownParts.map((leaf) => [
                leaf,
                unknownFactLine({ ...speakOpts(profile, opts), topic: item[leaf].topic }),
              ])
            )
          : undefined,
      };
    }
    if (name === 'check_coverage') {
      const res = checkCoverage(profile, String(args?.place || ''), { now });
      return {
        ok: true,
        tool: name,
        status: res.status,
        reason: res.reason,
        value: res.status === 'unknown' ? null : { areas: res.areas },
        say:
          res.status === 'unknown'
            ? unknownFactLine({ ...speakOpts(profile, opts), topic: 'areas we serve' })
            : undefined,
      };
    }
    return { ok: false, tool: String(name || ''), status: 'unknown', reason: 'no_such_tool' };
  } catch (err) {
    return {
      ok: false,
      tool: String(name || ''),
      status: 'unknown',
      reason: 'error',
      say: unknownFactLine(speakOpts(profile, opts)),
    };
  }
}

module.exports = { GIGO_FACT_TOOLS, SPEAKABLE_KEYS, runFactTool };
