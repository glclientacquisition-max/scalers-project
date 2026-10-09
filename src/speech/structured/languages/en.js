module.exports = {
  code: 'en',
  tts: 'en',
  name: 'English',
  directive: 'Write every say item in clear Kenyan English that is easy to say on a phone.',
  repair: 'Sorry, could you say that again?',
  unverified: 'Let me have the team confirm that detail for you.',
  priceLine(label, price) {
    return `${label} is ${price}.`;
  },
  coveredLine(place) {
    return `Yes, we cover ${place}.`;
  },
  notCoveredLine(place) {
    return `${place} is outside the areas we cover.`;
  },
  ack: 'Okay.',
};
