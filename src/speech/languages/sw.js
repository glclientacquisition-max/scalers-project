module.exports = {
  code: 'sw',
  tts: 'sw',
  repair: 'Samahani, sema tena?',
  unclear: 'Samahani, hurudia?',
  silence: 'Samahani, sikusikia.',
  filler: 'Sawa.',
  howHelp: 'Nikusaidie vipi?',
  closing: 'Asante. Kwaheri.',
  nameAsk: 'Jina lako nani?',
  directive:
    'Reply in natural Kiswahili only. Job nouns such as couch, carpet, mattress, or Airbnb may stay in English. Short spoken sentences.',
  services(items) {
    return `Tuna huduma za ${joinList(items, 'na')}.`;
  },
  priceKnown(amount) {
    return `Bei ni ${amount}.`;
  },
  priceUnknown: 'Sina bei hiyo kwenye rekodi. Naweza kuandika kwa timu.',
  coverage(places) {
    return `Tuko ${joinList(places, 'na')}.`;
  },
  nameAnswer(name) {
    return `Ndiyo, ni ${name}.`;
  },
  nameConfirm(name) {
    return `Je, naongea na ${name}?`;
  },
  complaint: 'Pole. Naelewa una lalamiko. Naweza kutuma kwa meneja.',
  understand: 'Sawa, nimeelewa.',
  ack: 'Sawa.',
};

function joinList(items, andWord) {
  const list = (items || []).map((item) => String(item || '').trim()).filter(Boolean);
  if (!list.length) return 'huduma zetu';
  if (list.length === 1) return list[0];
  return `${list.slice(0, -1).join(', ')}, ${andWord} ${list[list.length - 1]}`;
}
