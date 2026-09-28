/**
 * Time utility module strictly operating in Europe/Moscow timezone (MSK = UTC+3).
 * Independent of server/container local system timezone settings.
 */

function getMskParts(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Moscow',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hourCycle: 'h23'
  });
  const map = {};
  for (const p of formatter.formatToParts(d)) {
    if (p.type !== 'literal') map[p.type] = parseInt(p.value, 10);
  }
  return map;
}

/**
 * Returns current Date instance (timestamp).
 * Note: Fine checks compute the execution threshold relative to Moscow start of day (mskStartOfDay)
 * and FINES_RUN_HOUR_MS / FINES_RUN_MINUTE_MS, rather than using raw system getHours().
 */
function mskNow() {
  return new Date();
}

function mskHours(date = new Date()) {
  return getMskParts(date).hour;
}

function mskMinutes(date = new Date()) {
  return getMskParts(date).minute;
}

/**
 * Creates a UTC Date representing the specified Moscow local year/month/day/time.
 * Since Moscow is UTC+3 (fixed UTC offset), MSK time = UTC time + 3 hours.
 * Thus UTC time = MSK time - 3 hours.
 */
function mskToUtcDate(year, month, day, hour = 0, minute = 0, second = 0, millisecond = 0) {
  return new Date(Date.UTC(year, month - 1, day, hour - 3, minute, second, millisecond));
}

/**
 * Returns Moscow start of day (00:00:00.000 MSK) as a UTC Date object.
 */
function mskStartOfDay(date = new Date()) {
  const parts = getMskParts(date);
  return mskToUtcDate(parts.year, parts.month, parts.day, 0, 0, 0, 0);
}

/**
 * Calculates start (00:00:00.000 MSK) and end (23:59:59.999 MSK) range
 * for a day relative to baseDate (with dayOffset: 0 = today, 1 = tomorrow, etc.)
 */
function mskDayRange(dayOffset = 0, baseDate = new Date()) {
  const parts = getMskParts(baseDate);
  // Noon MSK in UTC:
  const baseMskNoonUtc = Date.UTC(parts.year, parts.month - 1, parts.day + dayOffset, 12 - 3, 0, 0);
  const targetParts = getMskParts(new Date(baseMskNoonUtc));

  const gte = mskToUtcDate(targetParts.year, targetParts.month, targetParts.day, 0, 0, 0, 0);
  const lte = mskToUtcDate(targetParts.year, targetParts.month, targetParts.day, 23, 59, 59, 999);

  return { gte, lte };
}

module.exports = {
  getMskParts,
  mskNow,
  mskHours,
  mskMinutes,
  mskToUtcDate,
  mskStartOfDay,
  mskDayRange,
};
