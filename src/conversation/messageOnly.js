// Message only is a lock, not a suggestion.
// tenants.after_hours_mode === 'message' may ask for a name, take a message,
// and save a callback. Booking, cancel, and visit reads stay off.
// 'serve' is unchanged.

function isMessageOnlyMode(mode) {
  return String(mode || '').trim().toLowerCase() === 'message';
}

function applyMessageOnlyCapabilities(capabilities = {}, mode) {
  if (!isMessageOnlyMode(mode)) return capabilities;
  return {
    ...capabilities,
    messageOnly: true,
    createAppointment: false,
    updateAppointment: false,
  };
}

/** Drop visit rows so a message-only prompt cannot read them aloud. */
function callerCardWithoutVisits(card) {
  if (!card || typeof card !== 'object') return card;
  return {
    ...card,
    openVisits: [],
    nextVisit: null,
    nextAppointment: null,
    nextVisitService: null,
    nextVisitWhen: null,
    nextVisitStatus: null,
    nextVisitLandmark: null,
    recentBookings: [],
  };
}

function messageOnlyNoVisitLine(language) {
  const lang = String(language || 'en').toLowerCase();
  if (lang === 'sw' || lang === 'sheng') {
    return 'Naweza kuchukua ujumbe. Siwezi kusoma ziara.';
  }
  return "I can take a message. I can't read a visit from here.";
}

module.exports = {
  isMessageOnlyMode,
  applyMessageOnlyCapabilities,
  callerCardWithoutVisits,
  messageOnlyNoVisitLine,
};
