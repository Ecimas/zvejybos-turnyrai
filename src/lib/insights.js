// Dienoraščio įžvalgos, kolekcija, tikslai ir kibimo prognozė. Viskas skaičiuojama telefone iš savų laimikių.
import { DAYPARTS, daypartOf } from './map.js';
import { bigger, bySize } from './format.js';

const pad = (n) => String(n).padStart(2, '0');
export const dayKey = (d) => { const x = new Date(d); return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`; };
const DAY = 864e5;
const live = (catches) => catches.filter((c) => c.status !== 'rejected');
// Išvykos data (YYYY-MM-DD) – vietos laiku vidurdienis, kad nepersislinktų per laiko juostas.
const tripTime = (b) => new Date(`${b.trip_date}T12:00:00`).getTime();

export const MONTH_ACC = ['sausį', 'vasarį', 'kovą', 'balandį', 'gegužę', 'birželį', 'liepą', 'rugpjūtį', 'rugsėjį', 'spalį', 'lapkritį', 'gruodį'];

// ---------------------------------------------------------------- Sezonas
export function seasonStats(catches, trips = [], now = new Date()) {
  const year = now.getFullYear();
  const fish = live(catches).filter((c) => new Date(c.captured_at_device).getFullYear() === year);
  const days = new Set([...fish.map((c) => dayKey(c.captured_at_device)),
    ...trips.filter((b) => new Date(tripTime(b)).getFullYear() === year).map((b) => b.trip_date)]);
  const biggest = fish.reduce((m, c) => bigger(m, c), null);
  return { year, count: fish.length, days: days.size, biggest };
}

// ---------------------------------------------------------------- Kolekcija
// Pagautos rūšys (pagal didžiausią) pirmiau, tada nepagautos – programėlės rūšių tvarka.
export function speciesCollection(catches, species) {
  const best = new Map();
  for (const c of live(catches)) {
    const b = best.get(c.species_id);
    if (bigger(b, c) === c) best.set(c.species_id, c);
  }
  const caught = species.filter((s) => best.has(s.id)).map((s) => ({ species: s, best: best.get(s.id) }))
    .sort((a, b) => bySize(a.best, b.best));
  const locked = species.filter((s) => !best.has(s.id)).map((s) => ({ species: s, best: null }));
  return { caught: caught.length, total: species.length, items: [...caught, ...locked] };
}

// ---------------------------------------------------------------- Įžvalgos
export function daypartStats(catches) {
  const fish = live(catches);
  const rows = DAYPARTS.map(([key, label]) => ({ key, label, count: 0 }));
  for (const c of fish) rows.find((r) => r.key === daypartOf(c.captured_at_device)).count += 1;
  const total = fish.length;
  rows.forEach((r) => { r.share = total ? r.count / total : 0; });
  const top = total ? rows.slice().sort((a, b) => b.count - a.count)[0] : null;
  return { rows, total, top: top && top.count ? top : null };
}

export function baitStats(catches, limit = 5) {
  const by = new Map();
  for (const c of live(catches)) {
    const raw = String(c.bait || '').trim();
    if (!raw) continue;
    const key = raw.toLocaleLowerCase('lt');
    const x = by.get(key) || { bait: raw.charAt(0).toLocaleUpperCase('lt') + raw.slice(1), count: 0, sum: 0, n: 0, species: new Set() };
    x.count += 1;
    if (c.length_mm) { x.sum += c.length_mm; x.n += 1; }
    x.species.add(c.species_id);
    by.set(key, x);
  }
  return [...by.values()].map((x) => ({ bait: x.bait, count: x.count, avgMm: x.n ? Math.round(x.sum / x.n) : null, species: [...x.species] }))
    .sort((a, b) => b.count - a.count || b.avgMm - a.avgMm).slice(0, limit);
}

const quart = (arr) => {
  const s = arr.slice().sort((a, b) => a - b);
  const at = (p) => s[Math.min(s.length - 1, Math.max(0, Math.ceil(p * s.length) - 1))];
  return [at(0.25), at(0.75)];
};
// Kokiu oru dažniausiai kibo (vidurinė pusė laimikių). null – kol mažiau nei 3 su oru.
export function weatherRanges(catches) {
  const w = live(catches).map((c) => c.weather).filter((x) => x && typeof x === 'object');
  const pick = (k) => w.map((x) => x[k]).filter((v) => typeof v === 'number' && Number.isFinite(v));
  const p = pick('pressure_hpa');
  const wind = pick('wind_ms');
  const t = pick('temp_c');
  if (Math.max(p.length, wind.length, t.length) < 3) return null;
  const out = {};
  if (p.length >= 3) { const [a, b] = quart(p); out.pressure = [Math.floor(a / 5) * 5, Math.ceil(b / 5) * 5 || Math.floor(a / 5) * 5 + 5]; }
  if (wind.length >= 3) { const [, b] = quart(wind); out.windMax = Math.max(1, Math.ceil(b)); }
  if (t.length >= 3) { const [a, b] = quart(t); out.temp = [Math.floor(a), Math.ceil(b)]; }
  return out;
}

// Žvejybos dienų tinklelis: `weeks` savaičių stulpeliai (pirmadienis–sekmadienis), paskutinis – ši savaitė.
export function fishingDays(catches, trips = [], now = new Date(), weeks = 12) {
  const fishDays = new Map();
  for (const c of live(catches)) { const k = dayKey(c.captured_at_device); fishDays.set(k, (fishDays.get(k) || 0) + 1); }
  const blankDays = new Set(trips.map((b) => b.trip_date));
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dow = (today.getDay() + 6) % 7; // pirmadienis = 0
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate() - dow - (weeks - 1) * 7);
  const cells = [];
  for (let i = 0; i < weeks * 7; i += 1) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    const k = dayKey(d);
    const n = fishDays.get(k) || 0;
    cells.push({ date: k, n, kind: d > today ? 'future' : n ? 'catch' : blankDays.has(k) ? 'blank' : 'none' });
  }
  const active = cells.filter((c) => c.kind === 'catch' || c.kind === 'blank').length;
  // Ilgiausia serija – dienos iš eilės, kai žvejota (su laimikiu ar be), per visą istoriją.
  const all = [...new Set([...fishDays.keys(), ...blankDays])].sort();
  let best = 0;
  let cur = 0;
  let prev = null;
  for (const k of all) {
    const t = new Date(`${k}T12:00:00`).getTime();
    cur = prev !== null && Math.round((t - prev) / DAY) === 1 ? cur + 1 : 1;
    best = Math.max(best, cur);
    prev = t;
  }
  return { cells, active, streak: best };
}

// ---------------------------------------------------------------- Tikslai
export const GOAL_KINDS = [
  ['length', 'Rūšis ≥ … cm'],
  ['count', '… laimikių'],
  ['species', '… rūšių'],
  ['new_species', 'Pagauti naują rūšį'],
  ['days', '… žvejybos dienų']
];
export function goalWindow(goal, now = new Date()) {
  if (goal.period === 'month') return [new Date(now.getFullYear(), now.getMonth(), 1).getTime(), new Date(now.getFullYear(), now.getMonth() + 1, 1).getTime()];
  if (goal.period === 'season') return [new Date(now.getFullYear(), 0, 1).getTime(), new Date(now.getFullYear() + 1, 0, 1).getTime()];
  return [-Infinity, Infinity];
}
export function periodLabel(goal, now = new Date()) {
  if (goal.period === 'month') return `per ${MONTH_ACC[now.getMonth()]}`;
  if (goal.period === 'season') return 'šį sezoną';
  return '';
}
const nounCount = (n, one, few, many) => {
  const m10 = n % 10;
  const m100 = n % 100;
  return `${n} ${m10 === 1 && m100 !== 11 ? one : m10 >= 2 && (m100 < 10 || m100 >= 20) ? few : many}`;
};
export function goalTitle(goal, spName = () => '', now = new Date()) {
  const p = periodLabel(goal, now);
  const t = goal.kind === 'length' ? `${goal.species_id ? spName(goal.species_id) : 'Bet kuri žuvis'} ≥ ${goal.target} cm`
    : goal.kind === 'count' ? nounCount(goal.target, 'laimikis', 'laimikiai', 'laimikių')
    : goal.kind === 'species' ? nounCount(goal.target, 'skirtinga rūšis', 'skirtingos rūšys', 'skirtingų rūšių')
    : goal.kind === 'days' ? nounCount(goal.target, 'žvejybos diena', 'žvejybos dienos', 'žvejybos dienų')
    : 'Pagauti naują rūšį';
  return p ? `${t} ${p}` : t;
}

// Pažanga: { value, target, pct, done, doneAt (ms), detail }
export function goalProgress(goal, catches, trips = [], now = new Date(), spName = () => '') {
  const [from, to] = goalWindow(goal, now);
  const created = goal.created_at ? new Date(goal.created_at).getTime() : -Infinity;
  const fish = live(catches).map((c) => ({ c, t: new Date(c.captured_at_device).getTime() }))
    .filter((x) => x.t >= from && x.t < to).sort((a, b) => a.t - b.t);
  let value = 0;
  let doneAt = null;
  let detail = '';
  if (goal.kind === 'length') {
    const pool = fish.filter((x) => !goal.species_id || x.c.species_id === goal.species_id);
    const best = pool.reduce((m, x) => Math.max(m, x.c.length_mm), 0);
    value = Math.floor(best / 10);
    const hit = pool.find((x) => x.c.length_mm >= goal.target * 10);
    if (hit) doneAt = hit.t;
    const left = goal.target * 10 - best;
    detail = best ? (left > 0 ? `Geriausia: ${String(best / 10).replace('.', ',')} cm – trūksta ${String(left / 10).replace('.', ',')} cm` : `Geriausia: ${String(best / 10).replace('.', ',')} cm`) : 'Dar nepagauta';
  } else if (goal.kind === 'count') {
    value = fish.length;
    if (fish.length >= goal.target) doneAt = fish[goal.target - 1].t;
    detail = `${Math.min(value, goal.target)} iš ${goal.target}`;
  } else if (goal.kind === 'species') {
    const seen = new Set();
    for (const x of fish) { seen.add(x.c.species_id); if (!doneAt && seen.size >= goal.target) doneAt = x.t; }
    value = seen.size;
    detail = `${Math.min(value, goal.target)} iš ${goal.target}`;
  } else if (goal.kind === 'days') {
    const ev = [...fish.map((x) => ({ k: dayKey(x.t), t: x.t })),
      ...trips.map((b) => ({ k: b.trip_date, t: tripTime(b) })).filter((x) => x.t >= from && x.t < to)].sort((a, b) => a.t - b.t);
    const seen = new Set();
    for (const x of ev) { seen.add(x.k); if (!doneAt && seen.size >= goal.target) doneAt = x.t; }
    value = seen.size;
    detail = `${Math.min(value, goal.target)} iš ${goal.target}`;
  } else {
    const before = new Set(live(catches).filter((c) => new Date(c.captured_at_device).getTime() < created).map((c) => c.species_id));
    const hit = fish.find((x) => x.t >= created && !before.has(x.c.species_id));
    value = hit ? 1 : 0;
    if (hit) doneAt = hit.t;
    detail = hit ? `Nauja rūšis – ${spName(hit.c.species_id)}` : `Jau pagautos ${before.size} rūš.`;
  }
  const done = doneAt !== null;
  const pct = done ? 1 : Math.min(1, value / goal.target);
  return { value, target: goal.target, pct, done, doneAt, detail };
}

// ---------------------------------------------------------------- Mėnulis ir kibimo prognozė
const SYNODIC = 29.530588853;
const MOON = [[1.84, 'jaunatis', '🌑'], [5.53, 'jaunas mėnulis', '🌒'], [9.22, 'priešpilnis', '🌓'], [12.91, 'mėnulis auga', '🌔'],
  [16.61, 'pilnatis', '🌕'], [20.3, 'mėnulis dyla', '🌖'], [23.99, 'delčia', '🌗'], [27.68, 'senas mėnulis', '🌘'], [30, 'jaunatis', '🌑']];
export function moonPhase(date = new Date()) {
  const jd = date.getTime() / DAY + 2440587.5;
  let age = (jd - 2451550.1) % SYNODIC;
  if (age < 0) age += SYNODIC;
  const [, name, emoji] = MOON.find(([lim]) => age < lim);
  return { age, name, emoji };
}

export const WIND_DIR = ['Š', 'ŠR', 'R', 'PR', 'P', 'PV', 'V', 'ŠV'];
export const windDir = (deg) => (typeof deg === 'number' ? WIND_DIR[Math.round(((deg % 360) + 360) % 360 / 45) % 8] : '');

// forecast: { hours: [{ t, temp, pressure, wind, dir, code }], sunrise, sunset } (t – ms)
// personal: daypartStats().top (nebūtina). Grąžina { score 1–10, label, windows [[nuo, iki] val.], now, trend, moon, reasons }
export function biteForecast(forecast, now = new Date(), personal = null) {
  const hours = forecast?.hours || [];
  if (!hours.length) return null;
  const at = (ms) => hours.reduce((best, h) => (Math.abs(h.t - ms) < Math.abs(best.t - ms) ? h : best), hours[0]);
  const cur = at(now.getTime());
  const before = at(now.getTime() - 3 * 3600e3);
  const after = at(now.getTime() + 3 * 3600e3);
  const trend = typeof after.pressure === 'number' && typeof before.pressure === 'number' ? after.pressure - before.pressure : 0;
  let score = 5;
  const reasons = [];
  if (Math.abs(trend) <= 1.5) { score += 1; reasons.push('stabilus slėgis'); }
  else if (trend < -1.5 && trend >= -4) { score += 1.5; reasons.push('slėgis lėtai krenta'); }
  else if (trend < -4) { score -= 0.5; reasons.push('slėgis staigiai krenta'); }
  else if (trend > 2.5) { score -= 1; reasons.push('slėgis kyla'); }
  if (cur.pressure >= 1005 && cur.pressure <= 1020) score += 0.5;
  else if (cur.pressure > 1028 || cur.pressure < 995) score -= 0.5;
  if (cur.wind >= 1 && cur.wind <= 5) { score += 1; reasons.push('vidutinis vėjas'); }
  else if (cur.wind > 8) { score -= 1.5; reasons.push('stiprus vėjas'); }
  if ([2, 3, 51, 53, 61].includes(cur.code)) score += 0.5;
  else if (cur.code >= 95) { score -= 2; reasons.push('perkūnija'); }
  else if ([65, 75, 82, 86].includes(cur.code)) score -= 1;
  if (cur.temp < -5 || cur.temp > 30) score -= 1;
  const moon = moonPhase(now);
  if (moon.age < 2 || moon.age > 27.5 || (moon.age > 13.8 && moon.age < 15.8)) { score += 0.5; reasons.push(moon.name); }
  score = Math.max(1, Math.min(10, Math.round(score)));
  const label = score <= 3 ? 'silpnas' : score <= 5 ? 'vidutinis' : score <= 7 ? 'geras' : 'puikus';
  const hr = (ms) => new Date(ms).getHours();
  const windows = [];
  if (forecast.sunrise) windows.push([Math.max(0, hr(forecast.sunrise) - 1), hr(forecast.sunrise) + 2, 'morning']);
  if (forecast.sunset) windows.push([Math.max(0, hr(forecast.sunset) - 2), hr(forecast.sunset), 'evening']);
  if (personal && (personal.key === 'day' || personal.key === 'night')) windows.push(personal.key === 'day' ? [11, 14, 'day'] : [22, 24, 'night']);
  if (personal) windows.sort((a, b) => (a[2] === personal.key ? -1 : b[2] === personal.key ? 1 : 0));
  return { score, label, windows: windows.slice(0, 2).map(([a, b]) => [a, b]), now: cur, trend, moon, reasons };
}
