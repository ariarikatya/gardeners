export const DEFAULT_GARDENER_PERCENT = Number(process.env.GARDENER_DEFAULT_PERCENT || 64.5);

export const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

export function calculateOrderSplit(price, writeoffPercent) {
  const p = Number(price) || 0;
  if (p <= 0) {
    return { employeeSalary: 0, companyShare: 0 };
  }
  const rawPercent = writeoffPercent && Number(writeoffPercent) > 0 ? Number(writeoffPercent) : DEFAULT_GARDENER_PERCENT;
  const ratio = rawPercent > 1 ? rawPercent / 100 : rawPercent;
  const employeeSalary = round2(p * ratio);
  const companyShare = round2(p - employeeSalary);
  return { employeeSalary, companyShare };
}
