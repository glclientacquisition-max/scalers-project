'use strict';
// Search keys shared by the compile (item side) and the reader (caller side), so both normalise the same way.
// English + Swahili + common STT spellings. General Kenyan vocabulary, not tenant data.
const SYN = {
  nyanya: 'tomato', tomatoes: 'tomato', kabichi: 'cabbage', cabbages: 'cabbage', sukuma: 'kale', sukumawiki: 'kale', kales: 'kale', collards: 'kale', collard: 'kale',
  kitunguu: 'onion', vitunguu: 'onion', onions: 'onion', leek: 'leeks', parachichi: 'avocado', avocados: 'avocado', ndizi: 'banana', bananas: 'banana',
  embe: 'mango', maembe: 'mango', hoho: 'capsicum', pilipili: 'chilli', chili: 'chilli', chillies: 'chilli', pepper: 'capsicum', peppers: 'capsicum',
  karoti: 'carrot', carrots: 'carrot', spinachi: 'spinach', tikiti: 'watermelon', matikiti: 'watermelon', mche: 'seedling', miche: 'seedling', seedlings: 'seedling',
  plants: 'seedling', plant: 'seedling', miti: 'tree', mti: 'tree', trees: 'tree', mitishamba: 'herb', herbs: 'herb', matunda: 'fruit', tunda: 'fruit', fruits: 'fruit',
  mboga: 'vegetable', vegetables: 'vegetable', veggies: 'vegetable', managu: 'managu', mnanaa: 'mint',
  usafi: 'clean', kusafisha: 'clean', cleaning: 'clean', cleaner: 'clean', kina: 'deep', zulia: 'carpet', mazulia: 'carpet', carpets: 'carpet', rug: 'carpet', rugs: 'carpet',
  godoro: 'mattress', magodoro: 'mattress', mattresses: 'mattress', sofas: 'sofa', couch: 'sofa', viti: 'seat', kiti: 'seat', seats: 'seat', dirisha: 'window', madirisha: 'window', windows: 'window',
  chumba: 'bedroom', vyumba: 'bedroom', bedrooms: 'bedroom', bed: 'bedroom', br: 'bedroom', bedroomed: 'bedroom', ofisi: 'office', maofisi: 'office', offices: 'office', nyumba: 'house', houses: 'house', home: 'house',
  kimoja: '1', moja: '1', mbili: '2', viwili: '2', tatu: '3', vitatu: '3', nne: '4', vinne: '4', tano: '5', vitano: '5', one: '1', two: '2', three: '3', four: '4', five: '5',
  kuhamia: 'move', kuhama: 'move', moving: 'move', ujenzi: 'construction', building: 'construction', renovation: 'construction',
};
const STOP = new Set(['the', 'a', 'an', 'of', 'and', 'or', 'for', 'per', 'with', 'do', 'you', 'have', 'how', 'much', 'is', 'are', 'what', 'which', 'kinds', 'kind', 'types', 'type', 'any', 'some', 'your', 'price', 'prices', 'cost', 'costs', 'sell', 'offer',
  'ni', 'na', 'ya', 'wa', 'za', 'la', 'cha', 'vya', 'mna', 'una', 'bei', 'gani', 'ngapi', 'je', 'mnauza', 'unauza', 'kiasi', 'pesa', 'mnayo', 'iko', 'kuna', 'nataka', 'ningependa', 'please', 'tafadhali', 'i', 'want', 'need', 'would', 'like', 'to', 'me', 'tell', 'about', 'in', 'on', 'there', 'f1']);
function stem(w) {
  if (/^\d+$/.test(w) || w.length <= 4) return w;
  return w.replace(/(ies)$/, 'y').replace(/(oes)$/, 'o').replace(/([^s])s$/, '$1');
}
/** Text -> normalised tokens ("3-bedroom" -> ["3", "bedroom"], "nyanya" -> ["tomato"]). */
function tokens(text) {
  const s = String(text || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/ng'/g, 'ng').replace(/(\d)\s*-?\s*([a-z])/g, '$1 $2');
  const out = [];
  for (const raw of s.split(/[^a-z0-9]+/)) {
    if (!raw || STOP.has(raw) || (raw.length === 1 && !/\d/.test(raw))) continue;
    const w = SYN[raw] || stem(raw);
    if (w && !STOP.has(w)) out.push(SYN[w] || w);
  }
  return out;
}
module.exports = { tokens, SYN, STOP, stem };
