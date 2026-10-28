import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeLeaderboard, catchPoints, rerank, leagueStandings, leaguePoints } from '../../src/lib/scoring.js';
import { duelBracket, sha256hex, roundsFor, roundName } from '../../src/lib/duels.js';
import { points, scoreText, describeFormat, coefText, gapText } from '../../src/lib/format.js';

const H = 3600e3;
const now = Date.now();
const iso = (off) => new Date(now + off).toISOString();
const A = '71000000-0000-4000-8000-000000000071';
const B = '72000000-0000-4000-8000-000000000072';
let n = 0;
const c = (user, species, len, off) => ({ id: `c${++n}`, user_id: user, species_id: species, length_mm: len, captured_at_device: iso(off), received_at: iso(off), status: 'approved' });

test('taškai už rūšį: tie patys skaičiai kaip SQL teste F1', () => {
  const t = { id: 't', format: 'species_points', top_n: 2, min_length_mm: 0, starts_at: iso(-24 * H), ends_at: iso(24 * H) };
  const catches = [c(A, 1, 700, -5 * H), c(A, 1, 600, -4 * H), c(A, 2, 300, -3 * H), c(A, 3, 990, -2 * H),
    c(B, 2, 400, -5 * H), c(B, 1, 450, -4 * H), c(B, 2, 411, -3 * H)];
  const rows = computeLeaderboard({ tournament: t, speciesIds: [1, 2], speciesPct: { 1: 100, 2: 200 }, entries: [A, B], catches });
  assert.deepEqual(rows.map((r) => [r.user_id, r.score_mm, r.rank]), [[B, 1622, 1], [A, 1300, 2]]);
  assert.equal(catchPoints(t, { species_id: 2, length_mm: 785 }, { 2: 150 }), 1177);
  assert.equal(catchPoints({ format: 'biggest' }, { species_id: 2, length_mm: 785 }, { 2: 150 }), 785);
});

test('taškų ir formatų tekstai', () => {
  assert.equal(points(1177), '117,7 tšk.');
  assert.equal(points(1200), '120 tšk.');
  assert.equal(scoreText({ format: 'species_points' }, 1500), '150 tšk.');
  assert.equal(scoreText({ format: 'biggest' }, 785), '78,5 cm');
  assert.equal(coefText(150), '×1,5');
  assert.equal(describeFormat({ format: 'duels', top_n: 1 }), 'Dvikovos · didžiausia žuvis rate');
  assert.equal(describeFormat({ format: 'species_points', top_n: 3 }), 'Taškai už rūšį · TOP-3');
  assert.match(gapText({ rank: 1, score_mm: 1500 }, { rank: 2, score_mm: 1300 }, { format: 'species_points' }), /trūksta 20 tšk\./);
});

test('diviziono lentelė perskaičiuoja vietas su lygiais rezultatais', () => {
  const rows = rerank([{ score_mm: 9, last_counted: 'a', rank: 3 }, { score_mm: 9, last_counted: 'a', rank: 4 }, { score_mm: 5, last_counted: 'b', rank: 8 }]);
  assert.deepEqual(rows.map((r) => r.rank), [1, 1, 3]);
});

test('lygos taškai: kaip SQL teste F3', () => {
  assert.equal(leaguePoints(1), 25);
  assert.equal(leaguePoints(10), 1);
  assert.equal(leaguePoints(11), 0);
  const C = 'c';
  const s = leagueStandings([
    [{ user_id: B, nickname: 'B', rank: 1 }, { user_id: A, nickname: 'A', rank: 2 }],
    [{ user_id: B, nickname: 'B', rank: 1 }, { user_id: A, nickname: 'A', rank: 2 }, { user_id: C, nickname: 'C', rank: 3 }],
    [{ user_id: A, nickname: 'A', rank: null }]
  ]);
  assert.deepEqual(s.map((r) => [r.nickname, r.points, r.events, r.wins, r.best_place, r.rank]),
    [['B', 50, 2, 2, 1, 1], ['A', 36, 2, 0, 2, 2], ['C', 15, 1, 0, 3, 3]]);
});

test('dvikovos: tvarka sutampa su SQL (sha256), ratai ir nugalėtojai', async () => {
  assert.equal(await sha256hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.equal(roundsFor(2), 1);
  assert.equal(roundsFor(5), 3);
  assert.equal(roundsFor(8), 3);
  assert.equal(roundName(3, 3), 'Finalas');
  assert.equal(roundName(2, 3), 'Pusfinalis');
  const ids = [1, 2, 3, 4, 5].map((i) => `7${i}000000-0000-4000-8000-00000000007${i}`);
  const t = { id: 'aaaaaaaa-0000-4000-8000-000000000020', format: 'duels', top_n: 1, min_length_mm: 0, starts_at: iso(-60 * H), ends_at: iso(12 * H) };
  const entries = ids.map((user_id) => ({ user_id, joined_at: iso(-61 * H) })).concat([{ user_id: 'late', joined_at: iso(-59 * H) }]);
  const catches = [];
  ids.concat(['late']).forEach((u, i) => [0, 1, 2].forEach((r) => catches.push(c(u, 1, u === 'late' ? 990 : (i + 1) * 100, -59 * H + r * 24 * H))));
  const rows = await duelBracket({ tournament: t, entries, catches });
  const r1 = rows.filter((r) => r.round === 1);
  // Ta pati tvarka kaip SQL teste F5
  assert.deepEqual(r1.flatMap((r) => [r.a_id, r.b_id]).filter(Boolean), [ids[3], ids[1], ids[4], ids[2], ids[0]]);
  assert.equal(r1.length, 3);
  assert.ok(!rows.some((r) => r.a_id === 'late' || r.b_id === 'late'), 'vėlavęs nepatenka');
  assert.ok(rows.filter((r) => r.round < 3).every((r) => r.status === 'done' && r.winner_id === (r.b_id && r.b_score > r.a_score ? r.b_id : r.a_id)));
  const final = rows.filter((r) => r.round === 3);
  assert.equal(final.length, 1);
  assert.equal(final[0].status, 'live');
  assert.equal(final[0].winner_id, null);
  assert.ok([final[0].a_id, final[0].b_id].includes(ids[4]), 'stipriausias finale');
  assert.equal(final[0].starts_at, new Date(now - 12 * H).toISOString());
  // Nedvikovų turnyrui – tuščia; mažiau nei 2 dalyviai – tuščia
  assert.deepEqual(await duelBracket({ tournament: { ...t, format: 'biggest' }, entries, catches }), []);
  assert.deepEqual(await duelBracket({ tournament: t, entries: entries.slice(0, 1), catches }), []);
});

test('dvikovos: lygiosios – laimi pirmas poroje; prieš startą rezultatų nėra', async () => {
  const t = { id: 'x', format: 'duels', top_n: 2, min_length_mm: 0, starts_at: iso(-2 * H), ends_at: iso(-1 * H) };
  const entries = [{ user_id: A, joined_at: iso(-3 * H) }, { user_id: B, joined_at: iso(-3 * H) }];
  const rows = await duelBracket({ tournament: t, entries, catches: [c(A, 1, 500, -1.5 * H), c(B, 1, 500, -1.5 * H)] });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].winner_id, rows[0].a_id);
  const soon = await duelBracket({ tournament: { ...t, starts_at: iso(H), ends_at: iso(2 * H) }, entries: entries.map((e) => ({ ...e, joined_at: iso(-H) })), catches: [] });
  assert.equal(soon[0].status, 'upcoming');
  assert.equal(soon[0].winner_id, null);
});
