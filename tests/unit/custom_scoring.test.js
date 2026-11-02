import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeLeaderboard, catchPoints } from '../../src/lib/scoring.js';
import {
  validateRules, fishPoints, defaultRules, describeRules, summarizeRules, exampleLines, localHour, customScores
} from '../../src/lib/custom_scoring.js';
import { describeFormat, scoreText } from '../../src/lib/format.js';

// Tas pats rinkinys kaip tests/db/test_custom_scoring.sql – rezultatai turi sutapti su serveriu.
export const RULES = {
  v: 1,
  base: 'cm',
  species: [{ id: 1, min_cm: 50, m: 150, max: 2 }, { id: 2, min_cm: 20, m: 200, max: null }, { id: 3, min_cm: 45, m: 130, max: 3 }],
  bonuses: [
    { type: 'len_min', cm: 70, add: 200 }, { type: 'len_min', cm: 90, add: 500 }, { type: 'species', add: 100 },
    { type: 'biggest', add: 300 }, { type: 'time', from: 22, to: 5, m: 120 }, { type: 'first', add: 50 }
  ],
  aggregate: { mode: 'best_n', n: 3 },
  tiebreak: ['biggest_fish', 'earliest']
};
const A = 'a', B = 'b', C = 'c', D = 'd';
const T = { id: 't', format: 'custom', scoring: RULES, starts_at: '2026-06-01T00:00:00Z', ends_at: '2026-06-03T00:00:00Z', min_length_mm: 0, top_n: 1 };
const fish = (id, user, species_id, length_mm, at, extra = {}) => ({
  id, user_id: user, species_id, length_mm, captured_at_device: at, received_at: at, status: 'approved', ...extra
});
const CATCHES = [
  fish('c01', A, 1, 720, '2026-06-01T10:00:00Z'),
  fish('c02', A, 2, 315, '2026-06-01T20:30:00Z'), // 23:30 Lietuvoje – naktis ×1,2
  fish('c03', A, 1, 480, '2026-06-01T11:00:00Z'), // per trumpa lydeka
  fish('c04', A, 1, 910, '2026-06-02T08:00:00Z'),
  fish('c05', A, 1, 600, '2026-06-02T09:00:00Z'), // trečia lydeka – viršija maks. 2
  fish('c06', B, 3, 500, '2026-06-01T08:00:00Z'), // pirmoji turnyro žuvis
  fish('c07', B, 3, 455, '2026-06-01T09:00:00Z'),
  fish('c08', B, 2, 250, '2026-06-01T12:00:00Z'),
  fish('c09', B, 2, 199, '2026-06-01T13:00:00Z'), // per trumpas ešerys
  fish('c10', C, 4, 700, '2026-06-01T14:00:00Z'), // ne ta rūšis
  fish('c11', C, 2, 300, '2026-06-02T21:00:00Z'), // 00:00 Lietuvoje
  fish('c12', D, 2, 360, '2026-06-01T11:00:00Z')
];

test('taisyklių tikrinimas', () => {
  assert.equal(validateRules(RULES), '');
  assert.equal(validateRules(defaultRules()), '');
  assert.match(validateRules({ ...RULES, base: 'x' }), /Pasirink/);
  assert.match(validateRules({ ...RULES, species: [{ id: 1, min_cm: 0, m: 100, max: null }, { id: 1, min_cm: 0, m: 100, max: null }] }), /kartojasi/);
  assert.match(validateRules({ ...RULES, bonuses: [{ type: 'time', from: 5, to: 5, m: 100 }] }), /pabaiga/);
  assert.match(validateRules({ ...RULES, aggregate: { mode: 'best_n', n: 0 } }), /N/);
  assert.match(validateRules({ ...RULES, tiebreak: ['earliest', 'earliest'] }), /lygiųjų/);
  assert.match(validateRules({ ...RULES, species: [{ id: 1, min_cm: 0, m: 1.5, max: null }] }), /Koeficientas/);
  assert.match(validateRules(null), /tuščios/);
});

test('Lietuvos valanda', () => {
  assert.equal(localHour(Date.parse('2026-06-01T20:30:00Z')), 23);
  assert.equal(localHour(Date.parse('2026-11-02T20:30:00Z')), 22);
});

test('vienos žuvies taškai', () => {
  const p = (c) => fishPoints(RULES, c, Date.parse(c.captured_at_device));
  assert.equal(p(CATCHES[0]), 1280);  // 72 × 1,5 + 20
  assert.equal(p(CATCHES[1]), 756);   // 31,5 × 2 × 1,2
  assert.equal(p(CATCHES[3]), 1865);  // 91 × 1,5 + 50 (tik didžiausia riba)
  assert.equal(p(CATCHES[6]), 591);   // 45,5 × 1,3 = 59,15 -> 59,1
  assert.equal(catchPoints(T, CATCHES[2]), 0, 'per trumpa – 0');
  assert.equal(catchPoints(T, CATCHES[0]), 1280);
});

test('lentelė: maks. rūšies, geriausios N, premijos, lygiosios', () => {
  const rows = computeLeaderboard({ tournament: T, speciesIds: [1, 2, 3], entries: [A, B, C, D], catches: CATCHES,
    profiles: { a: { nickname: 'Aras' }, b: { nickname: 'Benas' }, c: { nickname: 'Cezis' }, d: { nickname: 'Dovas' } } });
  assert.deepEqual(rows.map((r) => [r.nickname, r.rank, r.score_mm, r.counted]), [
    ['Aras', 1, 4401, 3],   // 1865 + 1280 + 756 + 2 rūšys × 10 + didžiausia 30
    ['Benas', 2, 1991, 3],  // 650 + 591 + 500 + 2 × 10 + pirmoji 5
    ['Dovas', 3, 820, 1],   // lygu su Cezis – didesnė žuvis
    ['Cezis', 4, 820, 1]
  ]);
  assert.equal(scoreText(T, 4401), '440,1 tšk.');
  assert.equal(describeFormat(T), 'Savos taškų taisyklės');
});

test('lygiosios: anksčiau pasiekė', () => {
  const r = { ...RULES, bonuses: [], tiebreak: ['earliest'] };
  const t = { ...T, scoring: r };
  const cs = [fish('x1', A, 2, 300, '2026-06-01T12:00:00Z'), fish('x2', B, 2, 300, '2026-06-01T10:00:00Z')];
  const rows = computeLeaderboard({ tournament: t, entries: [A, B], catches: cs, profiles: { a: { nickname: 'A' }, b: { nickname: 'B' } } });
  assert.deepEqual(rows.map((x) => [x.user_id, x.rank]), [[B, 1], [A, 2]]);
  const same = computeLeaderboard({ tournament: { ...t, scoring: { ...r, tiebreak: [] } }, entries: [A, B], catches: cs, profiles: {} });
  assert.deepEqual(same.map((x) => x.rank), [1, 1], 'be lygiųjų taisyklių – ta pati vieta');
});

test('kg, už žuvį, N kiekvienos rūšies, visos', () => {
  const base = { v: 1, species: [], bonuses: [], tiebreak: [] };
  const cs = [
    { c: fish('k1', A, 1, 700, '2026-06-01T10:00:00Z', { weight_g: 2350 }), ms: Date.parse('2026-06-01T10:00:00Z') },
    { c: fish('k2', A, 1, 650, '2026-06-01T11:00:00Z'), ms: Date.parse('2026-06-01T11:00:00Z') },
    { c: fish('k3', A, 2, 300, '2026-06-01T12:00:00Z', { weight_g: 410 }), ms: Date.parse('2026-06-01T12:00:00Z') },
    { c: fish('k4', A, 2, 280, '2026-06-01T13:00:00Z', { weight_g: 390 }), ms: Date.parse('2026-06-01T13:00:00Z') }
  ];
  const kg = customScores({ ...base, base: 'kg', species: [{ id: 1, min_cm: 0, m: 1000, max: null }, { id: 2, min_cm: 0, m: 2000, max: null }],
    bonuses: [{ type: 'weight_min', g: 2000, add: 100 }], aggregate: { mode: 'all', n: 1 } }, cs);
  // 2,35 kg × 10 = 23,5 + 10; 0,41 × 20 = 8,2; 0,39 × 20 = 7,8; be svorio neįskaitoma
  assert.deepEqual(kg.map((r) => [r.score_mm, r.counted]), [[335 + 82 + 78, 3]]);
  const each = customScores({ ...base, base: 'fish', aggregate: { mode: 'best_n_per_species', n: 1 }, bonuses: [{ type: 'per_fish', add: 5 }] }, cs);
  assert.deepEqual(each.map((r) => [r.score_mm, r.counted]), [[30, 2]], 'po 1 kiekvienos rūšies: (1 + 0,5) × 2');
  const over = customScores({ ...base, base: 'cm_over_min', species: [{ id: 1, min_cm: 60, m: 100, max: null }], aggregate: { mode: 'best', n: 1 } }, cs);
  assert.deepEqual(over.map((r) => r.score_mm), [100], '(70 − 60) cm');
});

test('aprašymai ir pavyzdys', () => {
  const name = (id) => ({ 1: 'Lydeka', 2: 'Ešerys', 3: 'Starkis' }[id]);
  const lines = describeRules(RULES, name);
  assert.ok(lines.some((l) => l.includes('Lydeka ×1,5 nuo 50 cm, daugiausia 2')), lines.join('\n'));
  assert.ok(lines.includes('Žuvis nuo 90 cm: +50 tšk.'));
  assert.ok(lines.includes('Pagauta 22–5 val.: ×1,2'));
  assert.ok(lines.includes('Sumuojamos 3 geriausios žuvys'));
  assert.ok(lines.includes('Lygiosios: didesnė žuvis → anksčiau pasiekė rezultatą'));
  assert.match(summarizeRules(RULES, name), /^Lydeka ×1,5 · ešerys ×2 · starkis ×1,3 · 3 geriausios · \+20 tšk\. už ≥ 70 cm/);
  const ex = exampleLines(RULES, name);
  assert.equal(ex[0], 'Lydeka 62 cm → 93 tšk.');
  assert.equal(exampleLines({ ...defaultRules(), base: 'kg' }, name, [{ id: 1 }])[0].startsWith('Lydeka 40 cm (0,576 kg) → 0,5 tšk.'), true);
});
