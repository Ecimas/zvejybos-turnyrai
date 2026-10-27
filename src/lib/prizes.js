// Prizinis fondas: padalijimas vietoms ir išmokų skaičiavimas.
// Pinigų programėlė neperveda – tik parodo, kas kiek laimi.

export const PRESETS = [
  { key: 'one', label: 'Tik nugalėtojui', split: [100] },
  { key: 'three', label: 'Trims: 50 / 30 / 20', split: [50, 30, 20] },
  { key: 'five', label: 'Penkiems: 40 / 25 / 15 / 12 / 8', split: [40, 25, 15, 12, 8] }
];

export function eur(cents) {
  const v = Math.round(Number(cents) || 0) / 100;
  const s = Number.isInteger(v) ? String(v) : v.toFixed(2).replace('.', ',');
  return `${s.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} €`;
}

// Eurai iš teksto: „500“, „1 250,50“, „99.9“ -> centai; netinkama -> NaN.
export function parseEur(text) {
  const t = String(text ?? '').replace(/\s/g, '').replace(',', '.');
  if (!t) return 0;
  if (!/^\d{1,6}(\.\d{1,2})?$/.test(t)) return NaN;
  return Math.round(Number(t) * 100);
}

export function validateSplit(split) {
  if (!Array.isArray(split) || split.length < 1 || split.length > 10) return 'Nurodyk nuo 1 iki 10 prizinių vietų';
  if (split.some((p) => !Number.isInteger(p) || p <= 0 || p > 100)) return 'Kiekvienai vietai – sveikas procentas nuo 1 iki 100';
  const sum = split.reduce((a, b) => a + b, 0);
  if (sum !== 100) return `Procentų suma turi būti 100 (dabar ${sum})`;
  if (split.some((p, i) => i > 0 && p > split[i - 1])) return 'Aukštesnė vieta negali gauti mažiau nei žemesnė';
  return null;
}

// Kiekvienai vietai – suma centais. Apvalinama žemyn, likę centai – pirmai vietai, kad suma sutaptų su fondu.
export function placeAmounts(fundCents, split) {
  if (!fundCents || !Array.isArray(split) || !split.length) return [];
  const amounts = split.map((p) => Math.floor((fundCents * p) / 100));
  amounts[0] += fundCents - amounts.reduce((a, b) => a + b, 0);
  return amounts;
}

// Išmokos pagal lentelę. Lygus rezultatas (vienoda vieta): užimtų vietų sumos dalijamos po lygiai.
// board – eilutės su rank (1, 2, 2, 4 …), surikiuotos pagal vietą.
export function payouts(board, fundCents, split) {
  const amounts = placeAmounts(fundCents, split);
  const out = new Map();
  if (!amounts.length) return out;
  const rows = board.filter((r) => r.rank !== null && r.rank !== undefined);
  let i = 0;
  while (i < rows.length && i < amounts.length) {
    const rank = rows[i].rank;
    let j = i;
    while (j < rows.length && rows[j].rank === rank) j++;
    const group = rows.slice(i, j);
    const pool = amounts.slice(i, j).reduce((a, b) => a + b, 0);
    const each = Math.floor(pool / group.length);
    group.forEach((r, k) => out.set(r.user_id, each + (k === 0 ? pool - each * group.length : 0)));
    i = j;
  }
  return out;
}

export function sponsorTotal(sponsors) {
  return (sponsors || []).reduce((a, s) => a + (Number(s.amount_cents) || 0), 0);
}
