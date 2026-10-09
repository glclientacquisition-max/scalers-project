// Deterministic entity extraction grounded in the active tenant profile.

const { normalizeProducts } = require('./productCatalog');
const { normalizeServices } = require('./liveKnowledge');
const { normalizeLocations } = require('./businessLocations');
const { isJunkCallerName } = require('./callerNameQuality');
const {
  canonicalizeCallerName,
  collectKnownCallerNames,
  collisionGroupFor,
  namesLikelySame,
  parseSpelledCallerName,
  pickCollisionChoice,
} = require('./callerNameMatch');
const { isLocationRefusal } = require('./visitLocation');
const { looksLikeNonConsentAck } = require('./callCorrectives');
const { quantityWord } = require('./numberWords');

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}+\s:'’-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function entity(value, source, confidence = 0.9, confirmed = true) {
  return {
    value: String(value || '').trim(),
    source,
    confidence,
    confirmed,
  };
}

function phraseAppears(text, phrase) {
  const haystack = ` ${normalizeText(text)} `;
  const needle = normalizeText(phrase);
  return Boolean(needle && haystack.includes(` ${needle} `));
}

const GENERIC_SERVICE_WORDS = new Set([
  'cleaning', 'clean', 'service', 'services', 'repair', 'repairs', 'wash', 'washing',
  'general', 'deep', 'home', 'house', 'office', 'full', 'basic', 'standard', 'premium',
  'usafi', 'kusafisha', 'huduma', 'installation', 'install', 'maintenance', 'visit',
]);

function distinctiveServiceTokens(name, services) {
  const tokens = normalizeText(name)
    .split(' ')
    .filter((word) => word.length >= 4 && !GENERIC_SERVICE_WORDS.has(word));
  return tokens.filter((token) => {
    const owners = services.filter((service) =>
      normalizeText(service.name).split(' ').includes(token)
    );
    return owners.length === 1;
  });
}

function findCatalogMatch(text, profile = {}) {
  const products = normalizeProducts(profile.productCatalog);
  const candidates = [];
  for (const product of products) {
    candidates.push({
      kind: 'product',
      canonical: product.name,
      terms: [product.name, product.sku, ...product.aliases].filter(Boolean),
    });
  }
  const services = normalizeServices(profile.servicesCatalog);
  for (const service of services) {
    candidates.push({
      kind: 'service',
      canonical: service.name,
      // "usafi wa carpet" or "the sofa" names the job by its object. A token
      // that appears in exactly one service name is enough to pick that service.
      terms: [service.name, ...distinctiveServiceTokens(service.name, services)].filter(Boolean),
    });
  }

  let best = null;
  for (const candidate of candidates) {
    for (const term of candidate.terms) {
      if (!phraseAppears(text, term)) continue;
      const score = normalizeText(term).length;
      if (!best || score > best.score) {
        best = { ...candidate, matched: term, score };
      }
    }
  }
  return best;
}

function cleanNameCapture(raw, opts = {}) {
  const value = String(raw || '')
    .replace(/\s+(?:and|na|calling|looking|nataka|speaking|here)\b.*$/i, '')
    .trim();
  if (!isPlausibleCallerName(value)) return null;
  return canonicalizeCallerName(value, {
    knownNames: opts.knownNames,
    preferKnown: opts.preferKnown !== false,
  });
}

function looksLikeCompliment(text) {
  return /\b(?:i'?m|i am)\s+(?:so\s+|very\s+|really\s+|quite\s+|just\s+)?(?:impressed|happy|glad|pleased|grateful|thankful|amazed|delighted)\b/i.test(
    String(text || '')
  );
}

const IM_NAME_STOP =
  /^(and|na|calling|looking|speaking|here|from|in|at|to|for|who|that|by|your|with|about|of|work)$/i;

function earlierExplicitName(raw) {
  if (
    /(?:\bmy name is\b|\bi am called\b|\bi'm called\b|\bthis is\b|\bnaitwa\b|\bninaitwa\b|\bjina langu ni\b|\bjina ni\b)\s+[\p{L}'’-]/iu.test(
      raw
    )
  ) {
    return true;
  }
  if (
    /\b[\p{L}'’-]+(?:\s+[\p{L}'’-]+){0,2}\s+is(?:\s+(?:the|my))?\s+name\b/iu.test(raw)
  ) {
    return true;
  }
  if (/\b[\p{L}'’-]+(?:\s+[\p{L}'’-]+){0,2}\s+is calling\b/iu.test(raw)) return true;
  return false;
}

/** "I'm Alvin" is a name span. "I'm impressed by your work" is not. */
function imIntroductionName(text) {
  const raw = String(text || '');
  if (!raw || looksLikeCompliment(raw) || earlierExplicitName(raw)) return null;
  const im =
    /\b(?:i'?m|i am)\s+([\p{L}'’-]+)(?:\s+([\p{L}'’-]+))?(?:\s+([\p{L}'’-]+))?/iu.exec(
      raw
    );
  if (!im) return null;
  const collected = [];
  for (const word of [im[1], im[2], im[3]].filter(Boolean)) {
    if (IM_NAME_STOP.test(word)) break;
    collected.push(word);
  }
  return collected.join(' ') || null;
}


function extractName(text, opts = {}) {
  const raw = String(text || '');
  const spelled = parseSpelledCallerName(raw);
  if (spelled) {
    return canonicalizeCallerName(spelled, {
      knownNames: opts.knownNames,
      preferKnown: opts.preferKnown !== false,
    });
  }
  const explicit =
    /(?:\bmy name is\b|\bi am called\b|\bi'm called\b|\bthis is\b|\bnaitwa\b|\bninaitwa\b|\bjina langu ni\b|\bjina ni\b)\s+([\p{L}'’-]+(?:\s+[\p{L}'’-]+){0,2})/iu.exec(
      raw
    );
  if (explicit) return cleanNameCapture(explicit[1], opts);

  // Live miss HD_0ef68f8e7930 / HD_bc9f610692de: "Alvin is the name." / "Alvin is calling."
  const invertedName =
    /\b([\p{L}'’-]+(?:\s+[\p{L}'’-]+){0,2})\s+is(?:\s+(?:the|my))?\s+name\b/iu.exec(
      raw
    );
  if (invertedName) {
    const captured = cleanNameCapture(invertedName[1], opts);
    if (captured) return captured;
  }
  const isCalling =
    /\b([\p{L}'’-]+(?:\s+[\p{L}'’-]+){0,2})\s+is calling\b/iu.exec(raw);
  if (isCalling) {
    const captured = cleanNameCapture(isCalling[1], opts);
    if (captured) return captured;
  }

  const imValue = imIntroductionName(raw);
  if (imValue) {
    const wordCount = raw.trim().split(/\s+/).length;
    const allowIntro =
      opts.firstMissing === 'name' ||
      wordCount <= 6 ||
      /^(?:hi|hello|hey|habari)[,.]?\s+(?:i'?m|i am)\b/i.test(raw.trim());
    if (allowIntro) {
      const captured = cleanNameCapture(imValue, opts);
      if (captured) return captured;
    }
  }


  if (opts.firstMissing === 'name') {
    const spoken =
      /\b(?:it'?s|ni)\s+([\p{L}'’-]+(?:\s+[\p{L}'’-]+){0,2})/iu.exec(raw);
    if (spoken) return cleanNameCapture(spoken[1], opts);
  }
  const particle = namePlusParticle(raw);
  if (particle && opts.firstMissing === 'name') return cleanNameCapture(particle, opts);
  return null;
}

/** "Alvin, yeah?" is the name. The particle is not part of it. */
function namePlusParticle(text) {
  const match =
    /^([\p{L}'’-]+)(?:\s*,)?\s+(?:yeah|yep|yes|eh|eeh|ndio|ndiyo)\b[.?!]*$/iu.exec(
      String(text || '').trim()
    );
  return match ? match[1] : '';
}

const NAME_AFFIRMATION =
  /^(yes|yeah|yep|yup|ndiyo|ndio|sawa|okay|ok|sure|right|alright|poa|eeh|ehe|ee|correct|that'?s right|that is right|ni hivyo|ndivyo)(?:\s+(?:please|thanks|asante))?$/i;

const NAME_NEGATION =
  /(?:^|[^\p{L}])(no|nope|nah|hapana|siyo)(?:$|[^\p{L}])/iu;

function isNameAffirmation(text) {
  const lower = String(text || '')
    .trim()
    .toLowerCase()
    .replace(/[?.!,]+$/g, '')
    .trim();
  return Boolean(lower) && NAME_AFFIRMATION.test(lower);
}

function isNameNegation(text) {
  const value = String(text || '').trim();
  if (!value) return false;
  if (NAME_NEGATION.test(value)) return true;
  return /\b(wrong name|not my name|sio hiyo|si hivyo|si jina)\b/i.test(value);
}

function extractCorrectedName(text, opts = {}) {
  const explicit = extractName(text, { ...opts, preferKnown: false });
  if (explicit) return explicit;
  const match =
    /(?:\b(?:no|nope|nah|hapana|siyo)\b)\s*[,:]?\s*(?:it'?s\s+|ni\s+|jina(?:\s+langu)?\s+ni\s+)?([\p{L}'’-]+(?:\s+[\p{L}'’-]+){0,2})/iu.exec(
      String(text || '')
    );
  if (!match) return null;
  const value = match[1]
    .replace(/\s+(?:and|na|calling|looking|nataka)\b.*$/i, '')
    .trim();
  if (/^(not|that|this|it|ni|the|my|jina)$/i.test(value)) return null;
  if (!isPlausibleCallerName(value)) return null;
  return canonicalizeCallerName(value, {
    knownNames: opts.knownNames,
    preferKnown: false,
  });
}

function bareAskedFileName(text, pending) {
  const asked = String(pending || '').trim();
  if (!asked || isJunkCallerName(asked)) return false;
  let raw = String(text || '')
    .trim()
    .replace(/[.!?]+$/g, '')
    .trim();
  raw = raw.replace(/^(?:uh+|um+|erm+|er+|ah+|eh+|hmm+)[, ]+/i, '').trim();
  raw = raw.replace(/[.!?]+$/g, '').trim();
  if (!raw || isJunkCallerName(raw)) return false;
  const askedWords = asked.split(/\s+/).filter(Boolean);
  const heardWords = raw.split(/\s+/).filter(Boolean);
  if (heardWords.length !== askedWords.length) return false;
  return namesLikelySame(raw, asked);
}

const AFFIRM_LEAD =
  /^(?:uh+|um+|ah+)?[, ]*(?:yes|yeah|yah|yea|yep|yup|nya|nia|ndiyo|ndio|sawa|okay|ok|eeh|ehe|eh|ee|correct)\b/i;

function escapeName(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** "speaking with Alvin" and pack echo "unaongea na Alvin" / "naongea na Alvin". */
function spokenWithName(text, pending) {
  const escaped = escapeName(pending);
  if (!escaped) return false;
  return new RegExp(
    `\\b(?:speaking with|speaking to|talking with|talking to|unaongea na|naongea na|unazungumza na|niongee na)\\s+${escaped}\\b`,
    'i'
  ).test(String(text || ''));
}

function affirmsAskedFileName(text, pending, extracted) {
  const asked = String(pending || '').trim();
  if (!asked) return false;
  if (isNameAffirmation(text)) return true;
  const raw = String(text || '').trim();
  if (!AFFIRM_LEAD.test(raw)) return false;
  // Echo of the pack ask wins before a noisy lead token ("Nya") can look like a different name.
  if (spokenWithName(raw, asked)) return true;
  if (extracted && !namesLikelySame(extracted, asked) && !isJunkCallerName(extracted)) {
    return false;
  }
  if (
    /\b(?:speaking with|speaking to|talking with|talking to|unaongea na|naongea na|unazungumza na|niongee na)\s+[\p{L}'’-]+/iu.test(
      raw
    )
  ) {
    return false;
  }
  const named = extractName(raw, { knownNames: [asked], preferKnown: true });
  return Boolean(named && namesLikelySame(named, asked));
}

function fileLockedName(name, knownNames = []) {
  const { matchCallerName } = require('./callerNameMatch');
  const hit = matchCallerName(name, { knownNames, preferKnown: true });
  if (!hit || hit.score < 85) return null;
  if (hit.source === 'memory' || hit.source === 'file' || hit.source === 'alternate') {
    return hit.canonical;
  }
  return null;
}

/**
 * One-time name confirm/correct after first capture.
 * First extract stays unconfirmed. Next caller turn: negation+new name
 * overwrites; yes/continue confirms; later extracts may update without re-asking.
 * STT variants of a known name fold to that spelling instead of overwriting.
 * Collision pairs (Colin/Collins) stay unconfirmed until the caller picks or spells.
 */
function agentAskedPendingName(lastAgentText, pendingName) {
  const asked = String(lastAgentText || '');
  const pending = String(pendingName || '').trim();
  if (!asked || !pending) return false;
  const escaped = escapeName(pending);
  return new RegExp(
    `\\b(?:am i speaking with|am i talking (?:with|to)|je,?\\s*naongea na|naongea na|unaongea na|unazungumza na|niongee na|ni wewe)\\s+${escaped}\\b`,
    'i'
  ).test(asked);
}

function applyCallerNameConfirmation(
  previous = {},
  text = '',
  incomingEntities = {},
  opts = {}
) {
  const entities = { ...(incomingEntities || {}) };
  const prevName =
    String(previous?.caller?.name || '').trim() ||
    entityValue(previous?.entities?.name);
  const prevConfirmed = previous?.caller?.nameConfirmed === true;
  const extracted = entityValue(entities.name);
  const source = entities.name?.source || 'caller_explicit';
  const knownNames = opts.knownNames || [];
  const pendingPair = Array.isArray(previous?.caller?.nameCollision)
    ? previous.caller.nameCollision
    : null;
  const collisionPick = pendingPair ? pickCollisionChoice(text, pendingPair) : null;

  function samePerson(a, b) {
    return Boolean(a && b && namesLikelySame(a, b));
  }

  function stamp(name, nextSource, confirmed, confidence = 0.95) {
    if (!name) return entities;
    entities.name = entity(name, nextSource, confidence, confirmed);
    return entities;
  }

  function done(name, confirmed, nextSource, confidence, nameCollision = null) {
    if (name) stamp(name, nextSource || source, confirmed, confidence);
    return {
      name: name || null,
      nameConfirmed: Boolean(confirmed && name),
      entities,
      nameCollision: confirmed || !nameCollision ? null : nameCollision,
    };
  }

  if (collisionPick) {
    return done(collisionPick, true, 'caller_collision_pick', 0.98);
  }
  if (pendingPair && source === 'caller_spelled' && extracted) {
    return done(extracted, true, 'caller_spelled', 0.98);
  }
  if (pendingPair && source === 'caller_collision_pick' && extracted) {
    return done(extracted, true, 'caller_collision_pick', 0.98);
  }

  if (prevConfirmed) {
    if (isNameNegation(text)) {
      const corrected = extractCorrectedName(text, { knownNames });
      if (corrected) {
        const nextPair = collisionGroupFor(corrected);
        const locked = fileLockedName(corrected, knownNames);
        if (nextPair && !locked) {
          return done(corrected, false, 'caller_correction', 0.98, nextPair);
        }
        return done(corrected, true, 'caller_correction', 0.98);
      }
      // BRAIN_CALL_FIXES_D199 (d): "No, like, the mansion one" answers the
      // last line, not the name. Only a no about the name unlocks it.
      if (require('./callFixesD199').callFixesD199Enabled()) {
        const agent = String(opts.lastAgentText || '');
        const aboutName =
          /\b(?:name|jina|speaking with|naongea na|unaongea na)\b/i.test(agent) ||
          (prevName && agent.toLowerCase().includes(String(prevName).toLowerCase())) ||
          /\b(?:wrong name|not my name|si jina|sio jina|si hiyo jina)\b/i.test(text);
        if (!aboutName) {
          return done(prevName, true, previous?.entities?.name?.source || 'caller_explicit', 0.95);
        }
      }
      return done(prevName, false, previous?.entities?.name?.source || 'caller_explicit', 0.9);
    }
    if (extracted && extracted !== prevName) {
      if (samePerson(extracted, prevName) || isJunkCallerName(extracted)) {
        return done(prevName, true, previous?.entities?.name?.source || 'caller_explicit', 0.95);
      }
      return done(extracted, true, source, 0.95);
    }
    return done(
      prevName || extracted || null,
      true,
      previous?.entities?.name?.source || 'caller_explicit',
      0.95
    );
  }

  // A yes binds only the file name just asked, including pack language:
  // "Eeh, unaongea na Alvin?" after "Je, naongea na Alvin?".
  // It does not confirm some other "I'm …" span, and it does not bind a different name.
  const pendingForAsk = String(opts.pendingFileName || '').trim();
  const packAsked =
    Boolean(opts.fileNameJustAsked) ||
    Boolean(pendingForAsk && agentAskedPendingName(opts.lastAgentText, pendingForAsk));
  if (
    !prevConfirmed &&
    packAsked &&
    affirmsAskedFileName(text, pendingForAsk, extracted)
  ) {
    if (pendingForAsk) {
      const locked = fileLockedName(pendingForAsk, knownNames) || pendingForAsk;
      return done(locked, true, 'caller_file', 0.95);
    }
  }

  // "Uh, Alvin" after the file-name ask is that name, not a longer span.
  if (!prevConfirmed && opts.fileNameJustAsked && bareAskedFileName(text, opts.pendingFileName)) {
    const pending = String(opts.pendingFileName || '').trim();
    const locked = fileLockedName(pending, knownNames) || pending;
    return done(locked, true, 'caller_file', 0.95);
  }

  // Yes after the spoken "Am I speaking with {name}?" (visit-read path).
  if (!prevName && !extracted && isNameAffirmation(text)) {
    const pending = String(opts.pendingFileName || '').trim();
    if (pending && agentAskedPendingName(opts.lastAgentText, pending)) {
      const locked = fileLockedName(pending, knownNames) || pending;
      return done(locked, true, 'caller_file', 0.95);
    }
  }


  if (!prevName && extracted) {
    if (source === 'caller_spelled') {
      return done(extracted, true, source, entities.name?.confidence || 0.98);
    }
    // An "I'm …" span is confirmed only when it is the phone-file name.
    // A different span is not stored while that name is still being asked,
    // and it is not auto-confirmed just because it matches an alternate.
    if (source === 'caller_im') {
      const owner = String(opts.fileOwnerName || '').trim();
      if (owner && samePerson(extracted, owner)) {
        return done(owner, true, 'caller_file', 0.95);
      }
      if (owner) {
        delete entities.name;
        return done(null, false, source, 0.5);
      }
      const imPair = collisionGroupFor(extracted);
      return done(extracted, false, source, entities.name?.confidence || 0.9, imPair);
    }
    const locked = fileLockedName(extracted, knownNames);
    if (locked) {
      return done(locked, true, 'caller_file', 0.95);
    }
    const nextPair = collisionGroupFor(extracted);
    const autoConfirm = source === 'caller_explicit' && !nextPair;
    return done(
      extracted,
      autoConfirm,
      source,
      entities.name?.confidence || 0.9,
      nextPair
    );
  }


  if (prevName) {
    if (isHearAgainSignal(text)) {
      return done(
        prevName,
        false,
        previous?.entities?.name?.source || 'caller_explicit',
        0.9,
        pendingPair || collisionGroupFor(prevName)
      );
    }
    const corrected = isNameNegation(text) ? extractCorrectedName(text, { knownNames }) : null;
    if (corrected) {
      const nextPair = collisionGroupFor(corrected);
      const locked = fileLockedName(corrected, knownNames);
      if (nextPair && !locked) {
        return done(corrected, false, 'caller_correction', 0.98, nextPair);
      }
      return done(corrected, true, 'caller_correction', 0.98);
    }
    if (isNameNegation(text)) {
      return done(
        prevName,
        false,
        previous?.entities?.name?.source || 'caller_explicit',
        0.9,
        pendingPair || collisionGroupFor(prevName)
      );
    }
    if (pendingPair) {
      return done(prevName, false, previous?.entities?.name?.source || 'caller_explicit', 0.9, pendingPair);
    }
    if (extracted && extracted !== prevName) {
      if (samePerson(extracted, prevName)) {
        return done(prevName, true, previous?.entities?.name?.source || 'caller_explicit', 0.95);
      }
      return done(extracted, true, source, 0.95);
    }
    if (isNameAffirmation(text) || extracted === prevName || String(text || '').trim()) {
      return done(prevName, true, previous?.entities?.name?.source || 'caller_explicit', 0.95);
    }
    return done(prevName, false, previous?.entities?.name?.source || 'caller_explicit', 0.9);
  }

  return done(extracted || null, false, source, 0.9);
}

const NAME_BLOCKLIST = new Set([
  'yes',
  'no',
  'okay',
  'ok',
  'sawa',
  'ndiyo',
  'hapana',
  'uh',
  'uhhuh',
  'uh-huh',
  'mm',
  'mmm',
  'hmm',
  'hm',
  'hello',
  'hi',
  'hey',
  'please',
  'thanks',
  'thank',
  'callings',
  'calling',
  'manager',
  'someone',
  'human',
  'pardon',
  'sorry',
  'what',
  'huh',
  'eh',
  'nini',
  'repeat',
  'calling',
  'callings',
  'haijawekwa',
  'caller',
  'customer',
  'unknown',
  'looking',
  'available',
  'interested',
  'trying',
  'going',
  'coming',
  'here',
  'there',
  'just',
  'also',
  'still',
  'already',
  'currently',
  'booking',
  'cleaning',
  'tomorrow',
  'today',
  'kesho',
  'leo',
  'hivyo',
  'hiyo',
  'urgent',
  'emergency',
  'upset',
  'angry',
  'wrong',
  'the',
  'this',
  'that',
  'it',
  'and',
  'for',
  'from',
  'with',
  'about',
  'near',
  'opposite',
  'great',
  'yeah',
  'yep',
  'yup',
  'monthly',
  'morning',
  'afternoon',
  'charge',
  'fine',
]);

/**
 * Caller did not hear the last question. Not a name, slot fill, or misunderstanding.
 * Live miss: HD_a922d3f8ab52 treated "Pardon?" as completing the booking.
 */
function isHearAgainSignal(text) {
  const lower = String(text || '')
    .trim()
    .toLowerCase()
    .replace(/[?.!,]+$/g, '')
    .trim();
  if (!lower) return false;
  return /^(pardon( me)?|i beg your pardon|sorry|what|huh|eh|come again|say( that)? again|repeat( that)?|nini|sema tena|unasemaje|sikusikia|i (didn't|did not) (hear|catch)( that)?|what (was that|did you say)|could you (repeat|say that again)|can you repeat( that)?)$/i.test(
    lower
  );
}

function isBackchannelOrFragment(text) {
  const value = String(text || '').trim();
  if (!value) return true;
  if (isHearAgainSignal(value)) return true;
  const lower = value.toLowerCase().replace(/[?.!,]+$/g, '').trim();
  const compact = lower.replace(/[\s'-]+/g, '');
  if (
    /^(yes|no|yeah|yep|nah|okay|ok|sawa|ndiyo|hapana|uh|uhhuh|mm+|hmm+|then|hello|hi|hey|thanks|thank you|asante|poa|sure|right|alright|continue|go on)$/i.test(
      lower
    )
  ) {
    return true;
  }
  if (NAME_BLOCKLIST.has(compact) || NAME_BLOCKLIST.has(lower)) return true;
  // Cut-off STT fragments without a complete thought.
  if (/[—–]\s*$/.test(value) || /…\s*$/.test(value)) return true;
  if (
    /^(i('d| would)? like to|i want to|i need to|i have to)\b/i.test(lower) &&
    lower.split(/\s+/).length <= 6
  ) {
    return true;
  }
  return false;
}

// Open stems with no complement. "Nilikuwa nataka kujua" is unfinished even when
// a greeting sits in front of it, and even when Voice has not passed a flag yet.
const UNFINISHED_STEM =
  /^(nilikuwa(?:\s+(?:nauliza|nataka|ningetaka|ningependa|naomba))?(?:\s+(?:kujua|kuuliza|kuomba))?|nauliza|nataka(?:\s+(?:kujua|kuuliza|kuomba))?|ningetaka(?:\s+(?:kujua|kuuliza))?|ningependa(?:\s+(?:kujua|kuuliza))?|naomba(?:\s+(?:kujua|kuuliza))?|i was (?:just )?asking|i wanted to (?:ask|know))\b[, ]*(.*)$/i;

const LEADING_FILLER =
  /^(?:uh+|um+|ah+|eeh|eh|like|so|well|actually|i mean|nya|nia|yah|yea|yeah|yes|yep|ndiyo|ndio|sawa|okay|ok|mm+|mhm|hmm+)[, ]+/i;

const LEADING_GREETING =
  /^(?:namna gani|habari(?:\s+yako)?|niaje|mambo|vipi|sasa|how are you(?: doing)?)(?:[, ]+[\p{L}'’-]+)?[, ]*/iu;

function looksLikePhaticGoal(text) {
  const { looksLikePhaticCallerTurn } = require('./dynamicSpeech');
  return looksLikePhaticCallerTurn(text);
}

function callerAskSpecificity(text) {
  const value = String(text || '').toLowerCase();
  let score = 0;
  if (
    /\b(dishwash\w*|carpet|sofa|couch|mattress|upholstery|fumigation|plumb\w*|electric\w*)\b/.test(
      value
    )
  ) {
    score += 3;
  }
  if (
    /\b(clean\w*|inquir\w*|enquir\w*|booking|appointment|hold|visit|order|price|bei|services?|huduma)\b/.test(
      value
    ) ||
    /\boffer\b/.test(value)
  ) {
    score += 2;
  }
  if (/\b(request|previous|last time)\b/.test(value)) score += 1;
  return score;
}

function isIdentityEchoOnly(text) {
  const raw = String(text || '')
    .trim()
    .replace(
      /^(?:uh+|um+|eeh|eh|ndiyo|ndio|yes|yeah|yah|yea|nya|nia|sawa|okay|ok)[,.\s]+/i,
      ''
    )
    .replace(/[?.!]+$/g, '')
    .trim();
  return /^(?:je,?\s*)?(?:unaongea na|naongea na|unazungumza na|niongee na|speaking with|talking to|am i speaking with)\s+[\p{L}'’-]+$/iu.test(
    raw
  );
}

function isGreetingClause(text) {
  const value = String(text || '')
    .trim()
    .replace(/[?.!,]+$/g, '')
    .trim();
  if (!value) return true;
  if (
    /^(?:mm+|mhm|mm-?hm|uh-?huh|uh huh|uh+|um+|ah+|hmm+|eeh|eh|nya|nia|yah|yea|yeah|yes|yep|ok|okay|sawa|ndiyo|ndio)$/i.test(
      value
    )
  ) {
    return true;
  }
  return /^(?:namna gani|habari(?:\s+yako)?|niaje|mambo|vipi|sasa|how are you(?: doing)?)(?:[, ]+[\p{L}'’-]+)?$/iu.test(
    value
  );
}

const GOAL_FUNCTION_WORD =
  /^(?:kuhusu|about|if|whether|kama|that|the|a|an|ni|na|and|to|for|of|just|like|uh|um|so|well)$/i;

function isNonActionableAsk(text) {
  const value = String(text || '')
    .trim()
    .replace(/[?.!,]+$/g, '')
    .trim();
  if (!value) return true;
  if (
    /^(?:what else|anything else|and then|go on|continue|na nini|kisha|what about|how about)$/i.test(
      value
    )
  ) {
    return true;
  }
  const words = value.split(/[^\p{L}0-9]+/u).filter(Boolean);
  return words.length > 0 && words.every((word) => GOAL_FUNCTION_WORD.test(word));
}

function peelGoalClause(clause) {
  let value = String(clause || '').trim();
  if (!value) return '';
  if (
    isGreetingClause(value) ||
    isIdentityEchoOnly(value) ||
    isBackchannelOrFragment(value) ||
    looksLikePhaticGoal(value)
  ) {
    return '';
  }
  for (let i = 0; i < 6 && value; i += 1) {
    const filler = value.replace(LEADING_FILLER, '').trim();
    if (filler !== value) {
      value = filler;
      continue;
    }
    const greet = LEADING_GREETING.exec(value);
    if (greet && greet[0].length < value.length) {
      value = value.slice(greet[0].length).trim();
      continue;
    }
    break;
  }
  if (
    !value ||
    isGreetingClause(value) ||
    isIdentityEchoOnly(value) ||
    isBackchannelOrFragment(value) ||
    looksLikePhaticGoal(value)
  ) {
    return '';
  }
  const open = UNFINISHED_STEM.exec(value);
  if (!open) return isNonActionableAsk(value) ? '' : value;
  const stem = String(open[1] || '');
  const rest = String(open[2] || '')
    .replace(/^[, ]+/, '')
    .trim();
  const bareWant = /^(?:nataka|naomba|ningetaka|ningependa)$/i.test(stem);
  if (bareWant && rest && !/^(?:kujua|kuuliza|kuomba)\b/i.test(rest)) {
    return value;
  }
  if (!rest) return '';
  return peelGoalClause(rest);
}

/**
 * Actionable remainder of a caller turn. Unfinished stems, greetings, and
 * identity echoes drop out. Empty means this turn is not a goal.
 */
/**
 * The caller has not finished the thought ("Nilikuwa nauliza,", "Let's say",
 * a trailing "na" or "and"). Any reply, including the name ask, waits.
 * Ported from #609 (edfe8447, fe571063, 4e6abe8f).
 * @param {string} text
 */
function callerTurnStillOpen(text) {
  const { utteranceLooksIncomplete } = require('../speech/turnTaking');
  const raw = String(text || '').replace(/\s+/g, ' ').trim();
  if (!raw) return false;
  if (utteranceLooksIncomplete(raw)) return true;
  if (usableGoalRemainder(raw)) return false;
  return UNFINISHED_STEM.test(raw.replace(/[.!?,;:…—–-]+$/g, '').trim());
}

function usableGoalRemainder(text) {
  const raw = String(text || '').trim();
  if (!raw) return '';
  const parts = raw.split(/[.?!]+/);
  const kept = [];
  for (const part of parts) {
    const peeled = peelGoalClause(part);
    if (!peeled || isNonActionableAsk(peeled)) continue;
    kept.push(peeled);
  }
  return kept.join('. ').replace(/\s+/g, ' ').trim();
}

/**
 * Goal text must be a grounded ask. Voice may pass unfinished/weak; the stem
 * list still rejects when that flag is missing.
 * @param {string} text
 * @param {{ unfinished?: boolean, weak?: boolean }} [opts]
 */
function isRejectedGoalText(text, opts = {}) {
  if (opts.unfinished === true || opts.weak === true) return true;
  return !usableGoalRemainder(text);
}

function callerGoalText(text, opts = {}) {
  if (opts.unfinished === true || opts.weak === true) return '';
  return usableGoalRemainder(text);
}

function isPlausibleCallerName(value) {
  const name = String(value || '').trim();
  if (!name || name.length < 2 || name.length > 40) return false;
  if (isJunkCallerName(name)) return false;
  if (isHearAgainSignal(name) || isBackchannelOrFragment(name)) return false;
  // BRAIN_CALL_FIXES_D199 (d): "No, like, the mansion one" is not the name Like.
  const fixes = require('./callFixesD199');
  if (fixes.callFixesD199Enabled() && fixes.isFillerPhrase(name)) return false;
  const lower = name.toLowerCase();
  if (
    /\b(i('d| would)? like to|i want to|i need to|i have to|discuss|talk about|speak to|tell me|can you|could you)\b/i.test(
      lower
    )
  ) {
    return false;
  }
  const words = name.split(/\s+/);
  if (words.some((word) => NAME_BLOCKLIST.has(word.toLowerCase()))) return false;
  if (/^(?:impressed|amazed|delighted|grateful|thankful|pleased)$/i.test(lower)) return false;
  if (
    /\b(?:impressed|amazed|delighted|grateful|thankful|pleased|glad)\b/i.test(lower) &&
    /\b(?:by|your|with|about|work)\b/i.test(lower)
  ) {
    return false;
  }
  if (words.length > 3) return false;
  if (/\d/.test(name)) return false;
  if (!/^[\p{L}][\p{L}'’-]*(?:\s+[\p{L}][\p{L}'’-]*){0,2}$/u.test(name)) {
    return false;
  }
  return true;
}

function extractPhone(text) {
  const match = /(?:\+?254|0)\s*\d(?:[\s-]*\d){8}\b/.exec(String(text || ''));
  return match ? match[0].replace(/[\s-]/g, '') : null;
}

const NOT_A_VISIT_PLACE =
  /^(?:the\s+|a\s+|an\s+|my\s+|our\s+|your\s+)?(?:morning|afternoon|evening|night|today|tomorrow|week|monday|tuesday|wednesday|thursday|friday|saturday|sunday|leo|kesho|asubuhi|jioni|mchana|kitchen|bathroom|bedroom|sitting|room)$/i;

function extractLandmark(text) {
  const raw = String(text || '').trim();
  if (!raw || isLocationRefusal(raw)) return null;
  const labeled =
    /\b(?:location|landmark|address)\s+(?:is|ni|:)\s+([^!?.]+)/i.exec(raw);
  if (labeled) {
    const value = labeled[1]
      .replace(/\s+(?:and|na)\s+(?:my name|i am|i'm|naitwa)\b.*$/i, '')
      .trim();
    if (value && !extractWhen(value) && !NOT_A_VISIT_PLACE.test(value)) {
      return value.slice(0, 120);
    }
  }
  const near =
    /\b((?:near|opposite|next to|karibu(?:\s+na)?)\s+[^!?.]+)/i.exec(raw);
  if (near) {
    const value = near[1].trim();
    if (value && !extractWhen(value)) {
      // "Kitengela, near Naivas": the area before the landmark decides coverage.
      const lead = raw.slice(0, near.index).replace(/[,\s]+$/, '').trim();
      const leadIsPlace =
        /^[A-Za-z][\p{L}'’-]+(?:\s+[A-Za-z][\p{L}'’-]+){0,2}$/u.test(lead) &&
        !NOT_A_VISIT_PLACE.test(lead) &&
        !extractWhen(lead) &&
        !/^(?:i|we|it|yes|no|okay|sawa|niko|tuko|the|at|in)\b/i.test(lead);
      if (leadIsPlace) return `${lead}, ${value}`.slice(0, 120);
      // "... in Kitengela near the stage": the area sits right before the landmark.
      const areaBefore =
        /\b(?:in|at|kwa)\s+([A-Z][\p{L}'’-]+(?:\s+[A-Z][\p{L}'’-]+){0,2})$/u.exec(lead);
      const area = areaBefore ? areaBefore[1].trim() : '';
      if (area && !NOT_A_VISIT_PLACE.test(area) && !extractWhen(area)) {
        return `${area}, ${value}`.slice(0, 120);
      }
      return value.slice(0, 120);
    }
  }
  // "come to Rongai", "kuja Rongai": the destination is the visit place.
  const comeTo =
    /\b(?:come|coming|reach|deliver|kuja|kufika|fika)\s+(?:out\s+)?(?:to\s+)?([A-Z][\p{L}'’-]+(?:\s+[A-Z][\p{L}'’-]+){0,2})/u.exec(
      raw
    );
  if (comeTo) {
    const value = comeTo[1].trim();
    if (value && !extractWhen(value) && !NOT_A_VISIT_PLACE.test(value)) {
      return value.slice(0, 120);
    }
  }
  const inPlace =
    /\b(?:in|at|kwa)\s+((?:the\s+|my\s+|our\s+)?[A-Za-z][\p{L}'’-]+(?:\s*,\s*[A-Za-z][\p{L}'’-]+){0,3})/u.exec(
      raw
    );
  if (inPlace) {
    const value = inPlace[1].replace(/^(?:the|a|an|my|our|your)\s+/i, '').trim();
    if (
      value &&
      !extractWhen(value) &&
      !NOT_A_VISIT_PLACE.test(value) &&
      !/^(?:am|pm)$/i.test(value)
    ) {
      return value.slice(0, 120);
    }
  }
  const building = buildingAnswer(raw);
  if (building) return building;
  return null;
}

const BUILDING_ANSWER =
  /^(?:the\s+|my\s+|our\s+)?[\p{L}'’-]+(?:\s+[\p{L}'’-]+){0,4}\s+(?:apartments?|gates?|buildings?|flats?|courts?|mall|stage|house|nyumba)\b/iu;

function buildingAnswer(raw) {
  let value = String(raw || '').trim();
  value = value.replace(/[, ]*(?:eh|yeah|yep|yes|okay|ok)\b[.?!]*$/i, '').trim();
  value = value.replace(/[?.!,]+$/g, '').trim();
  if (!BUILDING_ANSWER.test(value)) return null;
  if (extractWhen(value)) return null;
  if (value.split(/\s+/).length > 6) return null;
  return value.slice(0, 120);
}

function extractWhen(text) {
  const raw = String(text || '');
  const relative =
    /\b(today|tomorrow|tonight|this (?:morning|afternoon|evening)|next (?:week|monday|tuesday|wednesday|thursday|friday|saturday|sunday)|leo|kesho|jioni|asubuhi)\b/i.exec(
      raw
    );
  const clock =
    /\b(?:at\s*)?\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)\b/i.exec(raw) ||
    /\bsaa\s+(?:moja|mbili|tatu|nne|tano|sita|saba|nane|tisa|kumi|\d{1,2})(?:\s+(?:asubuhi|mchana|jioni|usiku))?\b/i.exec(
      raw
    );
  const parts = [relative?.[0], clock?.[0]].filter(Boolean);
  if (relative && !clock) {
    const period = /\b(morning|asubuhi|afternoon|mchana|evening|jioni)\b/i.exec(raw);
    const word = period ? period[1].toLowerCase() : '';
    if (word && !String(relative[0]).toLowerCase().includes(word)) parts.push(word);
  }
  return parts.join(' ').trim() || null;
}

function extractQuantity(text, intent) {
  if (!['hold', 'order', 'booking'].includes(intent)) return null;
  if (looksLikeNonConsentAck(text)) return null;
  const raw = String(text || '');
  // A clock is the visit time, not a count. "7:00 AM" must not become quantity 7.
  const stripped = raw
    .replace(/\b(?:at\s*)?\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)\b/gi, ' ')
    .replace(/\b\d{1,2}\s+is\s+(?:okay|ok|fine)\b/gi, ' ');
  const digit = /\b(\d{1,3})\b/.exec(stripped);
  if (digit && !/\b(?:at|saa)\s*$/.test(stripped.slice(0, digit.index).toLowerCase())) {
    return digit[1];
  }
  return quantityWord(stripped);
}

function extractBudget(text) {
  const match =
    /\b(?:budget(?: is| ya)?|under|below|up to|hadi)\s*(?:ksh|kes|shillings?|bob)?\s*([\d,]+(?:\s*(?:k|thousand))?)\b/i.exec(
      String(text || '')
    );
  return match ? match[1].trim() : null;
}

function extractPolicyKey(text) {
  const value = normalizeText(text);
  const keys = ['returns', 'refund', 'exchange', 'delivery', 'payment', 'deposit', 'cancellation', 'warranty'];
  return keys.find((key) => value.includes(key)) || null;
}

function extractBranch(text, profile = {}) {
  for (const location of normalizeLocations(profile.businessLocations)) {
    const terms = [location.label, location.address, location.landmark].filter(Boolean);
    if (terms.some((term) => phraseAppears(text, term))) {
      return location.label || location.address || location.landmark;
    }
  }
  return null;
}

function shortSlotAnswer(text) {
  const value = String(text || '').trim();
  if (!value || value.length > 100) return null;
  if (looksLikeNonConsentAck(value)) return null;
  const words = value.split(/\s+/);
  if (words.length > 6) return null;
  if (isBackchannelOrFragment(value)) return null;
  return value.replace(/[?.!,]+$/g, '').trim() || null;
}

function extractConversationEntities(
  text,
  { profile = {}, intent = 'unknown', state = null } = {}
) {
  const entities = {};
  const catalog = findCatalogMatch(text, profile);
  if (catalog) {
    entities[catalog.kind] = entity(
      catalog.canonical,
      `tenant_${catalog.kind}_catalog`,
      1,
      true
    );
  }

  const pendingPair = Array.isArray(state?.caller?.nameCollision)
    ? state.caller.nameCollision
    : null;
  const knownNames = collectKnownCallerNames({ profile, state });
  const correcting = isNameNegation(text);
  const preferKnown = !correcting && !pendingPair;
  const collisionPick = pendingPair ? pickCollisionChoice(text, pendingPair) : null;
  if (collisionPick) {
    entities.name = entity(collisionPick, 'caller_collision_pick', 0.98, true);
  }
  const spelled = parseSpelledCallerName(text);
  if (spelled && !entities.name) {
    entities.name = entity(
      canonicalizeCallerName(spelled, {
        knownNames,
        preferKnown,
      }),
      'caller_spelled',
      0.98,
      false
    );
  }
  const missingSlots = Array.isArray(state?.goal?.missingSlots) ? state.goal.missingSlots : [];
  const name =
    entityValue(entities.name) ||
    extractName(text, {
      firstMissing: missingSlots.includes('name') ? 'name' : missingSlots[0],
      knownNames,
      preferKnown,
    });
  if (name && !entities.name) {
    const imRaw = imIntroductionName(text);
    const fromIm = Boolean(imRaw) && namesLikelySame(imRaw, name);
    entities.name = entity(name, fromIm ? 'caller_im' : 'caller_explicit', 0.95, false);
  }
  const phone = extractPhone(text);
  if (phone) entities.phone = entity(phone, 'caller_explicit', 0.98, true);
  const when = extractWhen(text);
  if (when) entities.when = entity(when, 'caller_explicit', 0.9, false);
  const fixesD199 = require('./callFixesD199');
  const fixesOn = fixesD199.callFixesD199Enabled();
  // BRAIN_CALL_FIXES_D199 (d): a count needs a countable thing, not a clock
  // ("9 works best") or a pronoun ("the mansion one").
  const quantity = fixesOn
    ? ['hold', 'order', 'booking'].includes(intent) && !looksLikeNonConsentAck(text)
      ? fixesD199.quantityWithUnit(text, {
          quantityAsked: (state?.goal?.missingSlots || [])[0] === 'quantity',
        })
      : null
    : extractQuantity(text, intent);
  if (quantity) entities.quantity = entity(quantity, 'caller_explicit', 0.9, false);
  const budget = extractBudget(text);
  if (budget) entities.budget = entity(budget, 'caller_explicit', 0.85, false);
  const policyKey = extractPolicyKey(text);
  if (policyKey) entities.policyKey = entity(policyKey, 'caller_explicit', 0.95, true);
  const branch = extractBranch(text, profile);
  if (branch) entities.branch = entity(branch, 'tenant_location_match', 1, true);
  const visitPlace = extractLandmark(text);
  if (visitPlace) entities.location = entity(visitPlace, 'caller_explicit', 0.9, false);

  const firstMissing = state?.goal?.missingSlots?.[0];
  const shortAnswer = shortSlotAnswer(text);
  if (
    !entities.name &&
    firstMissing === 'name' &&
    shortAnswer &&
    isPlausibleCallerName(shortAnswer)
  ) {
    entities.name = entity(
      canonicalizeCallerName(shortAnswer, {
        knownNames,
        preferKnown,
      }),
      'contextual_slot_answer',
      0.8,
      false
    );
  }
  if (
    !entities.product &&
    !entities.service &&
    firstMissing === 'subject' &&
    shortAnswer &&
    // BRAIN_CALL_FIXES_D199 (d): filler is never the service.
    !(fixesOn && fixesD199.isFillerPhrase(shortAnswer))
  ) {
    entities.requestedItem = entity(
      shortAnswer,
      'caller_requested_unverified',
      0.75,
      false
    );
  }
  if (!entities.when && firstMissing === 'when' && shortAnswer) {
    entities.when = entity(shortAnswer, 'contextual_slot_answer', 0.75, false);
  }
  if (
    !entities.location &&
    (firstMissing === 'location' || firstMissing === 'landmark' || firstMissing === 'area') &&
    shortAnswer &&
    !isLocationRefusal(shortAnswer) &&
    !/\b(?:don'?t know|not sure|no idea|sijui|hakuna)\b/i.test(shortAnswer) &&
    !extractWhen(shortAnswer) &&
    // BRAIN_CALL_FIXES_D199 (d): "9 works best" answers the time, not the place.
    !(
      fixesOn &&
      (fixesD199.looksLikeTimeFragment(shortAnswer) ||
        fixesD199.isFillerPhrase(shortAnswer) ||
        fixesD199.looksLikeClauseNotPlace(text))
    )
  ) {
    entities.location = entity(shortAnswer, 'contextual_slot_answer', 0.75, false);
  }

  return entities;
}

function entityValue(raw) {
  if (raw && typeof raw === 'object' && 'value' in raw) {
    return String(raw.value || '').trim();
  }
  return String(raw || '').trim();
}

module.exports = {
  normalizeText,
  entity,
  findCatalogMatch,
  extractName,
  looksLikeCompliment,
  imIntroductionName,

  extractCorrectedName,
  isNameAffirmation,
  affirmsAskedFileName,
  isNameNegation,
  applyCallerNameConfirmation,
  extractPhone,
  extractWhen,
  extractLandmark,
  extractQuantity,
  extractBudget,
  extractPolicyKey,
  extractBranch,
  extractConversationEntities,
  shortSlotAnswer,
  isHearAgainSignal,
  isBackchannelOrFragment,
  isRejectedGoalText,
  callerGoalText,
  callerTurnStillOpen,
  callerAskSpecificity,
  agentAskedPendingName,
  isPlausibleCallerName,
  entityValue,
};
