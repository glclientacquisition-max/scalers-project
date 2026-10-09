module.exports = {
  code: 'sw',
  tts: 'sw',
  name: 'Kiswahili',
  directive:
    'Write every say item in natural Kiswahili. Job nouns such as sofa, carpet, mattress or Airbnb may stay in English.',
  repair: 'Samahani, unaweza kurudia tafadhali?',
  unverified: 'Nitaomba timu ithibitishe hilo.',
  priceLine(label, price) {
    return `${label} ni ${price}.`;
  },
  coveredLine(place) {
    return `Ndiyo, tunafika ${place}.`;
  },
  notCoveredLine(place) {
    return `${place} iko nje ya maeneo tunayofika.`;
  },
  ack: 'Sawa.',
};
