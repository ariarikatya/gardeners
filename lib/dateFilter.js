export function formatDateInput(date, isEnd = false) {
  const d = new Date(date);
  if (isEnd) {
    d.setHours(23, 59, 59, 999);
  } else {
    d.setHours(0, 0, 0, 0);
  }
  return d;
}

export function getDateRange(rawStart, rawEnd) {
  const now = new Date();
  const start = rawStart ? formatDateInput(rawStart, false) : new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
  const end = rawEnd ? formatDateInput(rawEnd, true) : new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
  return { start, end };
}

/**
 * Parses query parameters from URL / searchParams to determine whether to filter by date.
 * Supports:
 * - all: '1' | 'true'
 * - period: 'all' | 'forever' | 'all-time'
 * - start / end
 * - dateFrom / dateTo (aliases)
 *
 * When no date boundaries are provided or an 'all' flag is passed, returns `{ isAll: true }`.
 * When date boundaries are provided, returns `{ isAll: false, start: Date, end: Date }`.
 */
export function parseDateRangeQuery(searchParams, options = {}) {
  const defaultToAll = options.defaultToAll ?? true;
  const params = searchParams instanceof URLSearchParams ? searchParams : new URLSearchParams(searchParams || '');

  const allRaw = params.get('all');
  const periodRaw = params.get('period')?.trim().toLowerCase();

  const isExplicitAll =
    allRaw === '1' ||
    allRaw === 'true' ||
    periodRaw === 'all' ||
    periodRaw === 'forever' ||
    periodRaw === 'all-time';

  if (isExplicitAll) {
    return { isAll: true, start: null, end: null };
  }

  const startRaw = params.get('start') || params.get('dateFrom') || null;
  const endRaw = params.get('end') || params.get('dateTo') || null;

  if (!startRaw && !endRaw) {
    if (defaultToAll) {
      return { isAll: true, start: null, end: null };
    }
    const { start, end } = getDateRange(null, null);
    return { isAll: false, start, end };
  }

  const { start, end } = getDateRange(startRaw, endRaw);
  return { isAll: false, start, end };
}
