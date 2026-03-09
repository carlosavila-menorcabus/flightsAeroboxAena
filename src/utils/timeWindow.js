function pad2(n) {
  return String(n).padStart(2, '0');
}

export function compute12hWindow(dateInput) {
  const s = String(dateInput || '').trim();
  if (!s) throw new Error('date is required');

  const normalized = s.length === 10 ? `${s}T00:00` : s;
  const d = new Date(normalized);
  if (Number.isNaN(d.getTime())) {
    throw new Error('Invalid date format. Use YYYY-MM-DD or YYYY-MM-DDTHH:mm');
  }

  const yyyy = d.getFullYear();
  const mm = pad2(d.getMonth() + 1);
  const dd = pad2(d.getDate());

  const noon = new Date(`${yyyy}-${mm}-${dd}T12:00:00`);
  const isMorning = d.getTime() < noon.getTime();

  const start = isMorning ? new Date(`${yyyy}-${mm}-${dd}T00:00:00`) : noon;
  const end = isMorning ? noon : new Date(`${yyyy}-${mm}-${dd}T23:59:00`);

  const toAerobox = (dt) => {
    const y = dt.getFullYear();
    const m = pad2(dt.getMonth() + 1);
    const da = pad2(dt.getDate());
    const h = pad2(dt.getHours());
    const mi = pad2(dt.getMinutes());
    return `${y}-${m}-${da}T${h}:${mi}`;
  };

  const toHHmm = (dt) => `${pad2(dt.getHours())}:${pad2(dt.getMinutes())}`;

  return {
    day: `${yyyy}-${mm}-${dd}`,
    startAerobox: toAerobox(start),
    endAerobox: toAerobox(end),
    startHHmm: toHHmm(start),
    endHHmm: toHHmm(end)
  };
}
