export const toDateKey = (d) => {
  if (!d) return '';
  const x = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(x.getTime())) return '';
  const ms = x.getTime() + 3 * 60 * 60 * 1000;
  return new Date(ms).toISOString().slice(0, 10);
};
