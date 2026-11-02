// Darbo dienos Lietuvoje: be šeštadienių, sekmadienių ir valstybinių švenčių (kaip serverio lt_holiday, 0036).
const D = 864e5;
const FIXED = ['01-01', '02-16', '03-11', '05-01', '06-24', '07-06', '08-15', '11-01', '11-02', '12-24', '12-25', '12-26'];

// Velykų sekmadienis (Grigaliaus kalendorius) – „YYYY-MM-DD“.
export function easter(y) {
  const a = y % 19; const b = Math.floor(y / 100); const c = y % 100;
  const d = Math.floor(b / 4); const e = b % 4; const f = Math.floor((b + 8) / 25); const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30; const i = Math.floor(c / 4); const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7; const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31); const day = ((h + l - 7 * m + 114) % 31) + 1;
  return `${y}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

// Vietinė (Vilniaus) data „YYYY-MM-DD“ ir savaitės diena.
const lt = (t) => new Date(t).toLocaleDateString('sv-SE', { timeZone: 'Europe/Vilnius' });
const ltDow = (t) => new Date(`${lt(t)}T12:00:00Z`).getUTCDay();

export function isHoliday(ymd) {
  const y = Number(ymd.slice(0, 4));
  if (FIXED.includes(ymd.slice(5))) return true;
  const es = easter(y);
  const mon = new Date(Date.parse(`${es}T12:00:00Z`) + D).toISOString().slice(0, 10);
  return ymd === es || ymd === mon;
}

export const isWorkday = (t) => { const w = ltDow(t); return w !== 0 && w !== 6 && !isHoliday(lt(t)); };

// Laikas po n darbo dienų (ta pati valanda).
export function addBusinessDays(from, days) {
  const d = new Date(from);
  let n = 0;
  while (n < days) {
    d.setTime(d.getTime() + D);
    if (isWorkday(d)) n += 1;
  }
  return d;
}

// Kiek darbo dienų liko iki termino (-1 – praėjo).
export function businessDaysLeft(deadline, now = Date.now()) {
  if (!deadline) return null;
  const end = Date.parse(deadline);
  if (end < now) return -1;
  let n = 0;
  const d = new Date(now);
  while (d.getTime() + D <= end + 1000) {
    d.setTime(d.getTime() + D);
    if (isWorkday(d)) n += 1;
  }
  return Math.max(n, 0);
}
