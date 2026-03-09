// Ensures Aerobox date range does not exceed max days in the future.
export function clampDaysAhead(daysAhead, maxDays) {
  const d = Number(daysAhead);
  if (!Number.isFinite(d) || d < 0) return 0;
  return Math.min(d, maxDays);
}

export function ymdFromDate(d) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

export function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}
