// Savos taškų taisyklės (formatas „custom“). Ta pati logika kaip SQL public.custom_scores (0033_custom_scoring.sql).
// Visi skaičiai – sveikieji, kad telefone ir serveryje rezultatas sutaptų iki dešimtosios:
//   koeficientai – šimtosiomis (150 = ×1,5), taškai – dešimtosiomis (200 = 20 tšk.), svoris – gramais.
// Lentelėje taškai saugomi dešimtosiomis (kaip „Taškai už rūšį“): 1280 -> „128 tšk.“

export const BASES = [
  ['cm', 'Už centimetrą', 'Žuvies taškai = ilgis cm × rūšies koeficientas'],
  ['cm_over_min', 'Už cm virš minimumo', 'Žuvies taškai = (ilgis − rūšies min. cm) × koeficientas'],
  ['fish', 'Už kiekvieną žuvį', 'Kiekviena įskaitoma žuvis duoda rūšies taškų'],
  ['kg', 'Už kilogramą', 'Žuvies taškai = svoris kg × koeficientas. Be svorio žuvis neįskaitoma; svorį žvejys įrašo pats']
];
export const AGGREGATES = [
  ['all', 'Visos žuvys'],
  ['best_n', 'Geriausios N'],
  ['best_n_per_species', 'N kiekvienos rūšies'],
  ['best', 'Tik geriausia']
];
export const TIEBREAKS = [
  ['biggest_fish', 'Didesnė žuvis'],
  ['earliest', 'Anksčiau pasiekė rezultatą'],
  ['most_fish', 'Daugiau žuvų']
];
// Premijos ir baudos (add – dešimtosiomis, gali būti neigiamas; m – šimtosiomis).
export const BONUSES = [
  ['len_min', 'Žuvis ne trumpesnė nei … cm', 'Taikoma didžiausia pasiekta riba'],
  ['weight_min', 'Žuvis ne lengvesnė nei … kg', 'Taikoma didžiausia pasiekta riba (tik su svoriu)'],
  ['per_fish', 'Už kiekvieną žuvį', 'Pridedama prie kiekvienos įskaitomos žuvies'],
  ['time', 'Pagauta tarp … ir … val.', 'Žuvies taškai padauginami'],
  ['species', 'Už kiekvieną skirtingą rūšį', 'Pridedama dalyviui'],
  ['biggest', 'Didžiausia turnyro žuvis', 'Pridedama tos žuvies savininkui'],
  ['first', 'Pirmoji turnyro žuvis', 'Pridedama pirmą žuvį pagavusiam']
];

export const LIMITS = { species: 30, bonuses: 20, n: 100, max: 100, cm: 300, m: 100000, add: 100000, g: 200000 };

export function defaultRules() {
  return { v: 1, base: 'cm', species: [], bonuses: [], aggregate: { mode: 'best_n', n: 5 }, tiebreak: ['biggest_fish', 'earliest'] };
}

const isInt = (x, lo, hi) => Number.isInteger(x) && x >= lo && x <= hi;

// Klaidos tekstas arba '' (tos pačios ribos kaip SQL public.valid_scoring).
export function validateRules(r) {
  if (!r || typeof r !== 'object' || Array.isArray(r)) return 'Taisyklės tuščios';
  if (r.v !== 1) return 'Netinkama taisyklių versija';
  if (!BASES.some(([k]) => k === r.base)) return 'Pasirink, už ką skaičiuojami taškai';
  if (!Array.isArray(r.species) || r.species.length > LIMITS.species) return 'Per daug rūšių';
  const seen = new Set();
  for (const s of r.species) {
    if (!s || !isInt(s.id, 1, 32767)) return 'Netinkama rūšis';
    if (seen.has(s.id)) return 'Rūšis kartojasi';
    seen.add(s.id);
    if (!isInt(s.min_cm, 0, LIMITS.cm)) return 'Min. ilgis – nuo 0 iki 300 cm';
    if (!isInt(s.m, 0, LIMITS.m)) return 'Koeficientas – nuo 0 iki 1000';
    if (s.max !== null && !isInt(s.max, 1, LIMITS.max)) return 'Maks. žuvų – nuo 1 iki 100';
  }
  if (!Array.isArray(r.bonuses) || r.bonuses.length > LIMITS.bonuses) return 'Per daug premijų';
  for (const b of r.bonuses) {
    if (!b || !BONUSES.some(([k]) => k === b.type)) return 'Netinkama premija';
    if (b.type === 'time') {
      if (!isInt(b.from, 0, 23) || !isInt(b.to, 0, 23) || b.from === b.to) return 'Laikas – nuo 0 iki 23 val., pradžia ≠ pabaiga';
      if (!isInt(b.m, 0, LIMITS.m)) return 'Daugiklis – nuo 0 iki 1000';
    } else {
      if (!isInt(b.add, -LIMITS.add, LIMITS.add)) return 'Premija – nuo −10000 iki 10000 tšk.';
      if (b.type === 'len_min' && !isInt(b.cm, 1, LIMITS.cm)) return 'Ilgis – nuo 1 iki 300 cm';
      if (b.type === 'weight_min' && !isInt(b.g, 1, LIMITS.g)) return 'Svoris – nuo 0,001 iki 200 kg';
    }
  }
  const a = r.aggregate;
  if (!a || !AGGREGATES.some(([k]) => k === a.mode)) return 'Pasirink, kas sumuojama';
  if (!isInt(a.n, 1, LIMITS.n)) return 'N – nuo 1 iki 100';
  if (!Array.isArray(r.tiebreak) || r.tiebreak.length > 3 || new Set(r.tiebreak).size !== r.tiebreak.length
    || r.tiebreak.some((k) => !TIEBREAKS.some(([x]) => x === k))) return 'Netinkamos lygiųjų taisyklės';
  return '';
}

const floorDiv = (a, b) => Math.floor(a / b);
const speciesRule = (r, id) => (r.species.length ? r.species.find((s) => s.id === id) || null : { id, min_cm: 0, m: 100, max: null });

// Paros valanda Lietuvoje (kaip SQL extract(hour from … at time zone 'Europe/Vilnius')).
const HOUR = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Vilnius', hour: 'numeric', hourCycle: 'h23' });
export const localHour = (ms) => Number(HOUR.format(new Date(ms)));
const inWindow = (h, from, to) => (from < to ? h >= from && h < to : h >= from || h < to);

// Ar žuvis tinka šioms taisyklėms (rūšis, min. ilgis, svoris kg režimui).
export function fishEligible(r, c) {
  const s = speciesRule(r, c.species_id);
  if (!s) return false;
  if (c.length_mm < s.min_cm * 10) return false;
  if (r.base === 'kg' && !(c.weight_g > 0)) return false;
  return true;
}

// Vienos žuvies taškai dešimtosiomis (be dalyvio premijų). ms – tikras laimikio laikas.
export function fishPoints(r, c, ms) {
  const s = speciesRule(r, c.species_id);
  if (!s) return 0;
  let p;
  if (r.base === 'cm') p = floorDiv(c.length_mm * s.m, 100);
  else if (r.base === 'cm_over_min') p = floorDiv(Math.max(0, c.length_mm - s.min_cm * 10) * s.m, 100);
  else if (r.base === 'fish') p = floorDiv(s.m, 10);
  else p = floorDiv((c.weight_g || 0) * s.m, 10000);
  const tw = r.bonuses.find((b) => b.type === 'time' && inWindow(localHour(ms), b.from, b.to));
  if (tw) p = floorDiv(p * tw.m, 100);
  const len = r.bonuses.filter((b) => b.type === 'len_min' && c.length_mm >= b.cm * 10).sort((a, b) => b.cm - a.cm)[0];
  if (len) p += len.add;
  const wt = r.bonuses.filter((b) => b.type === 'weight_min' && (c.weight_g || 0) >= b.g).sort((a, b) => b.g - a.g)[0];
  if (wt) p += wt.add;
  for (const b of r.bonuses) if (b.type === 'per_fish') p += b.add;
  return p;
}

const byPts = (a, b) => b.pts - a.pts || a.ms - b.ms || (a.c.id < b.c.id ? -1 : a.c.id > b.c.id ? 1 : 0);
const byTime = (a, b) => a.ms - b.ms || (a.c.id < b.c.id ? -1 : a.c.id > b.c.id ? 1 : 0);

// fish: [{ c: laimikis, ms: tikras laikas }] – jau įskaitomi turnyre (patvirtinti, laiku, dalyvio).
// Grąžina eilutes { user_id, score_mm, counted, last_counted (ms), best_len } be vietų.
export function customScores(r, fish) {
  const ok = fish.filter((f) => fishEligible(r, f.c)).map((f) => ({ ...f, pts: fishPoints(r, f.c, f.ms) }));
  const bonus = (type) => r.bonuses.filter((b) => b.type === type).reduce((s, b) => s + b.add, 0);
  const biggestAdd = bonus('biggest');
  const firstAdd = bonus('first');
  const speciesAdd = bonus('species');
  const biggest = ok.slice().sort((a, b) => b.c.length_mm - a.c.length_mm || byTime(a, b))[0];
  const first = ok.slice().sort(byTime)[0];

  const users = new Map();
  for (const f of ok) {
    if (!users.has(f.c.user_id)) users.set(f.c.user_id, []);
    users.get(f.c.user_id).push(f);
  }
  const rows = [];
  for (const [userId, list] of users) {
    // Rūšies maksimumas
    const perSp = new Map();
    const capped = [];
    for (const f of list.slice().sort(byPts)) {
      const s = speciesRule(r, f.c.species_id);
      const k = (perSp.get(f.c.species_id) || 0) + 1;
      perSp.set(f.c.species_id, k);
      if (s.max === null || k <= s.max) capped.push(f);
    }
    // Kas sumuojama
    let kept;
    const { mode, n } = r.aggregate;
    if (mode === 'all') kept = capped;
    else if (mode === 'best') kept = capped.slice(0, 1);
    else if (mode === 'best_n') kept = capped.slice(0, n);
    else {
      const cnt = new Map();
      kept = capped.filter((f) => { const k = (cnt.get(f.c.species_id) || 0) + 1; cnt.set(f.c.species_id, k); return k <= n; });
    }
    if (!kept.length) continue;
    let score = kept.reduce((s, f) => s + f.pts, 0);
    score += speciesAdd * new Set(kept.map((f) => f.c.species_id)).size;
    if (biggest && biggest.c.user_id === userId) score += biggestAdd;
    if (first && first.c.user_id === userId) score += firstAdd;
    rows.push({
      user_id: userId,
      score_mm: score,
      counted: kept.length,
      last_counted: Math.max(...kept.map((f) => f.ms)),
      best_len: Math.max(...kept.map((f) => f.c.length_mm))
    });
  }
  return rows;
}

// Lygiųjų raktai (mažesnis – aukščiau), kaip SQL.
export function tieKeys(r, row) {
  const keys = (r?.tiebreak || ['earliest']).map((k) => (k === 'biggest_fish' ? -row.best_len : k === 'most_fish' ? -row.counted : row.last_counted));
  while (keys.length < 3) keys.push(0);
  return keys;
}

// ---------------------------------------------------------------- Žmonėms skaitomas aprašymas
const num = (x) => String(x).replace('.', ',');
export const mText = (m) => `×${num(m / 100)}`;
export const addText = (add) => `${add >= 0 ? '+' : '−'}${num(Math.abs(add) / 10)} tšk.`;
const kgText = (g) => `${num(g / 1000)} kg`;

export function describeRules(r, spName = (id) => `#${id}`) {
  const out = [];
  out.push(BASES.find(([k]) => k === r.base)?.[2] ?? '');
  if (r.species.length) {
    out.push(`Rūšys: ${r.species.map((s) => `${spName(s.id)} ${r.base === 'fish' ? `${num(s.m / 100)} tšk.` : mText(s.m)}${s.min_cm ? ` nuo ${s.min_cm} cm` : ''}${s.max ? `, daugiausia ${s.max}` : ''}`).join('; ')}`);
  } else {
    out.push(r.base === 'fish' ? 'Visos rūšys: 1 tšk. už žuvį' : 'Visos rūšys ×1');
  }
  for (const b of r.bonuses) {
    if (b.type === 'len_min') out.push(`Žuvis nuo ${b.cm} cm: ${addText(b.add)}`);
    else if (b.type === 'weight_min') out.push(`Žuvis nuo ${kgText(b.g)}: ${addText(b.add)}`);
    else if (b.type === 'per_fish') out.push(`Už kiekvieną žuvį: ${addText(b.add)}`);
    else if (b.type === 'time') out.push(`Pagauta ${b.from}–${b.to} val.: ${mText(b.m)}`);
    else if (b.type === 'species') out.push(`Už kiekvieną skirtingą rūšį: ${addText(b.add)}`);
    else if (b.type === 'biggest') out.push(`Didžiausia turnyro žuvis: ${addText(b.add)}`);
    else if (b.type === 'first') out.push(`Pirmoji turnyro žuvis: ${addText(b.add)}`);
  }
  const a = r.aggregate;
  out.push(a.mode === 'all' ? 'Sumuojamos visos žuvys' : a.mode === 'best' ? 'Skaičiuojama tik geriausia žuvis'
    : a.mode === 'best_n' ? `Sumuojamos ${a.n} geriausios žuvys` : `Sumuojamos ${a.n} geriausios kiekvienos rūšies žuvys`);
  if (r.tiebreak.length) out.push(`Lygiosios: ${r.tiebreak.map((k) => TIEBREAKS.find(([x]) => x === k)[1].toLowerCase()).join(' → ')}`);
  return out;
}

// Trumpas vienos eilutės aprašymas kortelei.
export function summarizeRules(r, spName = (id) => `#${id}`) {
  const parts = [];
  if (r.species.length) parts.push(r.species.slice(0, 3).map((s) => `${spName(s.id).toLowerCase()} ${r.base === 'fish' ? `${num(s.m / 100)} tšk.` : mText(s.m)}`).join(' · ') + (r.species.length > 3 ? ' …' : ''));
  else parts.push(BASES.find(([k]) => k === r.base)?.[1] ?? '');
  const a = r.aggregate;
  parts.push(a.mode === 'all' ? 'visos žuvys' : a.mode === 'best' ? 'geriausia' : a.mode === 'best_n' ? `${a.n} geriausios` : `${a.n} kiekv. rūšies`);
  const len = r.bonuses.find((b) => b.type === 'len_min');
  if (len) parts.push(`${addText(len.add)} už ≥ ${len.cm} cm`);
  const more = r.bonuses.length - (len ? 1 : 0);
  if (more > 0) parts.push(`dar ${more} ${more % 10 === 1 && more % 100 !== 11 ? 'premija' : more % 10 >= 2 && more % 10 <= 9 && (more % 100 < 10 || more % 100 >= 20) ? 'premijos' : 'premijų'}`);
  const s = parts.join(' · ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// Gyvas pavyzdys: kiek taškų gautų tipiškos žuvys (be dalyvio premijų).
export function exampleLines(r, spName = (id) => `#${id}`, speciesList = []) {
  const ids = r.species.length ? r.species.map((s) => s.id).slice(0, 3) : speciesList.slice(0, 2).map((s) => s.id);
  const noon = Date.UTC(2026, 5, 1, 10, 0, 0); // 13 val. Lietuvoje
  return ids.map((id) => {
    const s = speciesRule(r, id);
    const len = Math.max(s.min_cm * 10 + 120, 400);
    const c = { id: 'x', user_id: 'x', species_id: id, length_mm: len, weight_g: Math.round((len / 10) ** 3 * 0.009) };
    if (!fishEligible(r, c)) return `${spName(id)} ${num(len / 10)} cm – neįskaitoma`;
    const p = fishPoints(r, c, noon);
    return `${spName(id)} ${num(len / 10)} cm${r.base === 'kg' ? ` (${kgText(c.weight_g)})` : ''} → ${num(p / 10)} tšk.`;
  });
}
