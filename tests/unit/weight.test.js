// Svėrimas (0040): laimikis su ilgiu, svoriu arba abiem; turnyrai pagal svorį.
import test from 'node:test';
import assert from 'node:assert/strict';
import { computeLeaderboard, fitReason, catchPoints } from '../../src/lib/scoring.js';
import { size, sizeFull, kg, scoreText, describeFormat, gapText, minText, bySize, bigger, byWeight } from '../../src/lib/format.js';
import { recordFor, recordIds } from '../../src/lib/records.js';
import { seasonPoints, clubRecords } from '../../src/lib/clubs.js';
import { customScores } from '../../src/lib/custom_scoring.js';

const now = Date.now();
const H = 3600e3;
const iso = (ms) => new Date(ms).toISOString();
const T = (o) => ({ id: 't', format: 'biggest', top_n: 1, min_length_mm: 0, measure: 'weight', min_weight_g: 5000,
  starts_at: iso(now - 48 * H), ends_at: iso(now + 48 * H), ...o });
const C = (id, user, len, g, ago, o = {}) => ({ id, user_id: user, species_id: 1, length_mm: len, weight_g: g, status: 'approved',
  captured_at_device: iso(now - ago * H), received_at: iso(now - ago * H), ...o });

const catches = [
  C('b1', 'b', null, 15200, 30), C('b2', 'b', 640, 4100, 20),
  C('c1', 'c', 720, 9800, 10), C('c2', 'c', 900, 7000, 9, { species_id: 2 }),
  C('a1', 'a', null, 9800, 12)
];
const entries = ['a', 'b', 'c'];
const profiles = { a: { nickname: 'Wa_a' }, b: { nickname: 'Wb_b' }, c: { nickname: 'Wc_c' } };
const board = (t, sp = []) => computeLeaderboard({ tournament: t, speciesIds: sp, entries, catches, profiles })
  .map((r) => `${r.nickname}:${r.rank}:${r.score_mm}:${r.counted}`).join(' ');

test('svorio lentelė sutampa su SQL (test_weight W3)', () => {
  assert.equal(board(T(), [1]), 'Wb_b:1:15200:1 Wa_a:2:9800:1 Wc_c:3:9800:1');
  assert.equal(board(T({ format: 'top_n_sum', top_n: 2, min_weight_g: 0 })), 'Wb_b:1:19300:2 Wc_c:2:16800:2 Wa_a:3:9800:1');
  assert.equal(board(T({ measure: 'length', min_weight_g: 0 })).split(' ').map((x) => x.split(':').slice(0, 3).join(':')).join(' '),
    'Wc_c:1:900 Wb_b:2:640');
});

test('fitReason: be svorio, per lengva, be ilgio', () => {
  const t = T();
  assert.equal(fitReason(t, [], true, C('x', 'a', 700, null, 1)), 'no_weight');
  assert.equal(fitReason(t, [], true, C('x', 'a', null, 4999, 1)), 'too_light');
  assert.equal(fitReason(t, [], true, C('x', 'a', null, 5000, 1)), 'ok');
  assert.equal(fitReason(T({ measure: 'length' }), [], true, C('x', 'a', null, 5000, 1)), 'no_length');
  assert.equal(catchPoints(t, C('x', 'a', 700, 5300, 1)), 5300);
});

test('savos taisyklės: kg tinka tik pasvertiems, cm – tik išmatuotiems', () => {
  const fish = catches.filter((c) => c.user_id === 'b').map((c) => ({ c, ms: Date.parse(c.captured_at_device) }));
  const base = { v: 1, species: [], bonuses: [], aggregate: { mode: 'best', n: 1 }, tiebreak: ['earliest'] };
  assert.equal(customScores({ ...base, base: 'kg' }, fish)[0].score_mm, 152);
  assert.equal(customScores({ ...base, base: 'cm' }, fish)[0].score_mm, 640);
});

test('formatavimas: kg ir dydis', () => {
  assert.equal(kg(12450), '12,45 kg');
  assert.equal(size({ length_mm: null, weight_g: 9800 }), '9,80 kg');
  assert.equal(size({ length_mm: 815, weight_g: 9800 }), '81,5 cm');
  assert.equal(sizeFull({ length_mm: 720, weight_g: 9800 }), '72 cm · 9,80 kg');
  assert.equal(scoreText(T(), 15200), '15,20 kg');
  assert.equal(describeFormat(T()), 'Sunkiausia žuvis');
  assert.equal(describeFormat(T({ format: 'top_n_sum', top_n: 3 })), 'TOP-3 svorių suma');
  assert.equal(minText(T()), 'nuo 5 kg');
  assert.equal(minText(T({ measure: 'length', min_length_mm: 500 })), 'nuo 50 cm');
  assert.match(gapText({ rank: 1, score_mm: 9800 }, { rank: 2, score_mm: 9800 }, T()), /10 g/);
});

test('rekordai ir klubai – tik pagal ilgį', () => {
  const mine = [C('m1', 'me', null, 12000, 5), C('m2', 'me', 600, null, 4)];
  assert.equal(recordFor(mine, 1, 650).kind, 'record');
  assert.equal(recordFor([mine[0]], 1, 650).kind, 'first');
  assert.deepEqual([...recordIds(mine)], ['m2']);
  assert.equal(seasonPoints(catches, 'b', new Date().getFullYear()), 64);
  assert.deepEqual(clubRecords(catches, ['a', 'b']).records.map((r) => r.catch_id), ['b2']);
});

test('palyginimas: ilgis, tada svoris; svorio turnyre – atvirkščiai', () => {
  const list = [C('1', 'a', null, 15200, 1), C('2', 'a', 640, 4100, 1), C('3', 'a', 640, 5000, 1)];
  assert.deepEqual(list.slice().sort(bySize).map((c) => c.id), ['3', '2', '1']);
  assert.deepEqual(list.slice().sort(byWeight).map((c) => c.id), ['1', '3', '2']);
  assert.equal(list.reduce((m, c) => bigger(m, c), null).id, '3');
  assert.equal(list.reduce((m, c) => bigger(m, c, byWeight), null).id, '1');
});
