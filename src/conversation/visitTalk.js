// Caller lines about a visit or booking already on file.
// Shared by intent inference and next-best-action so the two cannot drift.

function looksLikeExistingVisitTalk(value) {
  return /\b(my visit|my appointment|the visit|that visit|ziara yangu|ile ziara|still coming|confirm(ing)? (the |my )?(visit|appointment)|my booking|my bookings|the booking|the bookings|any booking|any bookings|what (are|is) my (booking|bookings|visit|visits|appointment)|do i have (a |any )?(booking|bookings|visit|appointment)|bookings zangu|booking yangu|ziara zangu)\b/i.test(
    String(value || '')
  );
}

function looksLikePastBookingTalk(value) {
  return /\b(last (time|visit|job|booking|appointment)|previous (visit|booking|job)|last time you (came|were)|ile mara|mara ya mwisho)\b/i.test(
    String(value || '')
  );
}

function looksLikeFileVisitTalk(value) {
  return looksLikeExistingVisitTalk(value) || looksLikePastBookingTalk(value);
}

module.exports = {
  looksLikeExistingVisitTalk,
  looksLikePastBookingTalk,
  looksLikeFileVisitTalk,
};
