// Formatavimas lietuviškai.

const MONTHS = ['saus.', 'vas.', 'kov.', 'bal.', 'geg.', 'birž.', 'liep.', 'rugp.', 'rugs.', 'spal.', 'lapkr.', 'gruod.'];
const MONTHS_FULL = ['sausio', 'vasario', 'kovo', 'balandžio', 'gegužės', 'birželio', 'liepos', 'rugpjūčio', 'rugsėjo', 'spalio', 'lapkričio', 'gruodžio'];

const pad = (n) => String(n).padStart(2, '0');

export function cm(mm) {
  const n = Number(mm) || 0;
  const v = n / 10;
  return (Number.isInteger(v) ? String(v) : v.toFixed(1).replace('.', ',')) + ' cm';
}

export function time(d) {
  const x = new Date(d);
  return `${pad(x.getHours())}:${pad(x.getMinutes())}`;
}

export function shortDate(d) {
  const x = new Date(d);
  return `${MONTHS[x.getMonth()]} ${x.getDate()}`;
}

export function dateTime(d) {
  return `${shortDate(d)}, ${time(d)}`;
}

export function longDate(d) {
  const x = new Date(d);
  return `${MONTHS_FULL[x.getMonth()]} ${x.getDate()} d.`;
}

// Trukmė žmogui: „2 d. 14 val.“, „5 val. 12 min.“, „12 min.“
export function duration(ms) {
  const m = Math.max(0, Math.floor(ms / 60000));
  const d = Math.floor(m / 1440);
  const h = Math.floor((m % 1440) / 60);
  const min = m % 60;
  if (d > 0) return h > 0 ? `${d} d. ${h} val.` : `${d} d.`;
  if (h > 0) return min > 0 ? `${h} val. ${min} min.` : `${h} val.`;
  return `${Math.max(min, 1)} min.`;
}

export function phase(t, now = Date.now()) {
  const s = new Date(t.starts_at).getTime();
  const e = new Date(t.ends_at).getTime();
  if (now < s) return 'soon';
  if (now < e) return 'live';
  return 'done';
}

// Vėlyva registracija: late_join_minutes null – iki pabaigos, 0 – tik iki starto, N – N min. po starto.
export const LATE_JOIN = [
  [null, 'Iki pabaigos'],
  [0, 'Tik iki starto'],
  [60, '1 val. po starto'],
  [180, '3 val. po starto'],
  [360, '6 val. po starto'],
  [1440, '1 parą po starto']
];

export function registrationClosesAt(t) {
  const end = new Date(t.ends_at).getTime();
  const m = t.late_join_minutes;
  if (m === null || m === undefined) return end;
  return Math.min(end, new Date(t.starts_at).getTime() + m * 60e3);
}

export function registrationOpen(t, now = Date.now()) {
  return now < registrationClosesAt(t);
}

export function registrationLabel(t) {
  const m = t.late_join_minutes;
  if (m === null || m === undefined) return 'Iki pabaigos';
  if (m === 0) return 'Tik iki starto';
  return `Iki ${dateTime(new Date(registrationClosesAt(t)))}`;
}

export function timeLabel(t, now = Date.now()) {
  const p = phase(t, now);
  if (p === 'soon') return `Startas po ${duration(new Date(t.starts_at) - now)}`;
  if (p === 'live') return `Liko ${duration(new Date(t.ends_at) - now)}`;
  return `Baigėsi ${longDate(t.ends_at)}`;
}

// Lietuviškos daugiskaitos formos: 1 laimikis, 2 laimikiai, 10 laimikių.
export function plural(n, one, few, many) {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b === 1) return one;
  if (b >= 2 && b <= 9) return few;
  return many;
}

export function count(n, one, few, many) {
  return `${n} ${plural(n, one, few, many)}`;
}

export const FORMATS = {
  biggest: 'Didžiausia žuvis',
  top_n_sum: 'Kelių ilgių suma',
  species_points: 'Taškai už rūšį',
  duels: 'Dvikovos'
};

export function describeFormat(t) {
  if (t.format === 'biggest') return 'Didžiausia žuvis';
  if (t.format === 'species_points') return t.top_n === 1 ? 'Taškai už rūšį · geriausia žuvis' : `Taškai už rūšį · TOP-${t.top_n}`;
  if (t.format === 'duels') return t.top_n === 1 ? 'Dvikovos · didžiausia žuvis rate' : `Dvikovos · TOP-${t.top_n} suma rate`;
  return `TOP-${t.top_n} ilgių suma`;
}

// Taškai saugomi dešimtosiomis (ilgis mm × koeficientas / 100): 1177 -> „117,7 tšk.“
export function points(v) {
  const n = (Number(v) || 0) / 10;
  return (Number.isInteger(n) ? String(n) : n.toFixed(1).replace('.', ',')) + ' tšk.';
}

export const isPoints = (t) => t?.format === 'species_points';
export const scoreText = (t, v) => (isPoints(t) ? points(v) : cm(v));

// Rūšies koeficientas: 100 -> „×1“, 150 -> „×1,5“
export const coefText = (pct) => `×${String((Number(pct) || 100) / 100).replace('.', ',')}`;
export const COEFS = [50, 100, 150, 200, 250, 300, 400, 500];

// Kiek trūksta iki aukštesnės vietos. Lygus rezultatas: aukščiau tas, kas jį pasiekė anksčiau.
export function gapText(above, mine, t = null) {
  const gap = above.score_mm - mine.score_mm;
  if (gap <= 0) return `Tiek pat kaip #${above.rank} – jis pagavo anksčiau, reikia bent ${isPoints(t) ? '0,1 tšk.' : '1 mm'} daugiau`;
  return `Iki #${above.rank} trūksta ${scoreText(t, gap)}`;
}
