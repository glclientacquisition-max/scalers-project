module.exports = {
  code: 'en',
  tts: 'en',
  repair: 'Sorry, say that again?',
  unclear: 'Sorry, say that again?',
  silence: 'Sorry, I missed that.',
  filler: 'Okay.',
  howHelp: 'How can I help?',
  closing: 'Thank you. Goodbye.',
  nameAsk: 'May I have your name?',
  directive:
    'Reply in clear Kenyan English only. Short spoken sentences. Job words stay easy to say on a phone.',
  services(items) {
    return `We offer ${joinList(items, 'and')}.`;
  },
  priceKnown(amount) {
    return `The price is ${amount}.`;
  },
  priceUnknown: "I don't have that price on file. I can note it for the team.",
  coverage(places) {
    return `We reach ${joinList(places, 'and')}.`;
  },
  nameAnswer(name) {
    return `Yes, this is ${name}.`;
  },
  nameConfirm(name) {
    return `Am I speaking with ${name}?`;
  },
  complaint: 'Sorry. I understand you have a complaint. I can send it to the manager.',
  understand: 'Okay, I understand.',
  ack: 'Okay.',
};

function joinList(items, andWord) {
  const list = (items || []).map((item) => String(item || '').trim()).filter(Boolean);
  if (!list.length) return 'what we have on file';
  if (list.length === 1) return list[0];
  return `${list.slice(0, -1).join(', ')}, ${andWord} ${list[list.length - 1]}`;
}
