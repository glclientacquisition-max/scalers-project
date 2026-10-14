# Brief for Brain: "kesho" before dawn, and stray seconds in the window (HD_cc0481620c50)

Source: staging 02f5889b, call HD_cc0481620c50, Thursday 15 Oct 2026, 01:39 EAT.

## 1. "kesho" between 00:00 and 04:59 EAT
- **What happened:** at 01:39 EAT Thursday the caller asked for "kesho saa 8:00" (plus "Mchana."). The booking was saved as **Ijumaa** (Friday) 14:00.
- **Why it's ambiguous:** before dawn, most callers still count "kesho" (or "tomorrow") from the day they haven't slept on yet, so they mean Thursday afternoon.
- **Where it resolves (Brain code):** `src/conversation/appointmentHours.js`
  - The time gate (`hasTomorrow` → `offset = 1`, around line 239–282).
  - `formatDayOnlyWhen` (around line 441), which has the same `offset = 1`.
- **Ask:**
  - When `eatParts(now).minutesSinceMidnight < 300` and the text says kesho/tomorrow with no weekday or date, return a new ambiguous outcome instead of resolving. For example `{ ok:false, code:'small_hours_tomorrow' }`.
  - Ask once:
    - Swahili: "Unamaanisha leo Alhamisi mchana, au Ijumaa?" (the today weekday, the caller's period, then the next weekday)
    - English: "Do you mean today, Thursday afternoon, or Friday?"
  - If the caller answers "leo" or the weekday, resolve to offset 0; "Ijumaa" or "kesho" again resolves to offset 1. Never ask twice.
- **Voice side:** nothing to change. Voice speaks the line Brain returns. With VOICE_SW_TIME (#694) on, any clock in it is read in Swahili time.

## 2. Stray seconds in the window (14:00:46)
- **Cause:** `eatInstant()` in `src/conversation/appointmentHours.js` (line 119) works out EAT midnight by subtracting only whole minutes (`p.minutesSinceMidnight * 60000`). The seconds and milliseconds of `now` stay in, so the saved time comes out as 14:00:46.
- **Fix (one line):**
  - Floor to the minute: `const eatNow = Math.floor((now.getTime() + EAT_OFFSET_MS()) / 60000) * 60000;`
  - Or equivalently, zero seconds and milliseconds on the returned Date.
- **Test:** with `now = 2026-10-14T22:39:46.877Z`, the input "kesho saa 8 mchana" should give `windowStart` `…T11:00:00.000Z`.
