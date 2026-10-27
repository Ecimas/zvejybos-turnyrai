import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeLeaderboard, fitReason } from '../../src/lib/scoring.js';

const H = 3600 * 1000;
const now = Date.now();
const iso = (offsetMs) => new Date(now + offsetMs).toISOString();

const PIKE = 1;
const ZANDER = 3;
const A = 'a';
const B = 'b';

const t = {
  format: 'top_n_sum', top_n: 3, min_length_mm: 500,
  starts_at: iso(-24 * H), ends_at: iso(72 * H)
};

const c = (user, species, len, capOffset, extra = {}) => ({
  user_id: user, species_id: species, length_mm: len,
  captured_at_device: iso(capOffset), received_at: iso(Math.max(capOffset, -1)),
  status: 'approved', ...extra
});

// Tas pats scenarijus kaip tests/db/test_schema.sql – rezultatai turi sutapti.
const catches = [
  c(B, PIKE, 780, -20 * H), c(B, PIKE, 710, -19 * H), c(B, PIKE, 730, -18 * H), c(B, PIKE, 700, -17 * H),
  c(B, PIKE, 400, -16 * H),
  c(B, ZANDER, 950, -15 * H),
  { ...c(B, PIKE, 990, 2 * H), received_at: iso(0) },
  c(B, PIKE, 980, -48 * H),
  c(B, PIKE, 970, -1 * H, { status: 'pending' }),
  c(A, PIKE, 820, -10 * H)
];

const profiles = { [A]: { nickname: 'Ana' }, [B]: { nickname: 'Benas' } };

test('TOP-3 suma sutampa su SQL', () => {
  const rows = computeLeaderboard({ tournament: t, speciesIds: [PIKE], entries: [A, B], catches, profiles });
  assert.equal(rows.length, 2);
  assert.deepEqual(
    rows.map((r) => [r.user_id, r.rank, r.score_mm, r.counted]),
    [[B, 1, 2220, 3], [A, 2, 820, 1]]
  );
});

test('didžiausia žuvis', () => {
  const rows = computeLeaderboard({ tournament: { ...t, format: 'biggest' }, speciesIds: [PIKE], entries: [A, B], catches, profiles });
  assert.deepEqual(rows.map((r) => [r.user_id, r.rank, r.score_mm]), [[A, 1, 820], [B, 2, 780]]);
});

test('neužsiregistravusio laimikiai neįskaitomi', () => {
  const rows = computeLeaderboard({ tournament: t, speciesIds: [PIKE], entries: [B], catches, profiles });
  assert.deepEqual(rows.map((r) => r.user_id), [B]);
});

test('be rūšių apribojimo įskaitoma ir kita rūšis', () => {
  const rows = computeLeaderboard({ tournament: t, speciesIds: [], entries: [A, B], catches, profiles });
  const b = rows.find((r) => r.user_id === B);
  assert.equal(b.score_mm, 950 + 780 + 730);
});

test('lygūs rezultatai: anksčiau pasiektas aukščiau', () => {
  const list = [c(A, PIKE, 800, -5 * H), c(B, PIKE, 800, -6 * H)];
  const rows = computeLeaderboard({ tournament: { ...t, format: 'biggest' }, entries: [A, B], catches: list, profiles });
  assert.deepEqual(rows.map((r) => [r.user_id, r.rank]), [[B, 1], [A, 2]]);
});

test('visiškai lygūs dalijasi vieta', () => {
  const list = [c(A, PIKE, 800, -5 * H), c(B, PIKE, 800, -5 * H), c('c', PIKE, 700, -5 * H)];
  const rows = computeLeaderboard({ tournament: { ...t, format: 'biggest' }, entries: [A, B, 'c'], catches: list, profiles });
  assert.deepEqual(rows.map((r) => r.rank), [1, 1, 3]);
});

test('priežastys', () => {
  const sp = [PIKE];
  assert.equal(fitReason(t, sp, false, c(A, PIKE, 800, -1 * H)), 'not_entered');
  assert.equal(fitReason(t, sp, true, c(A, ZANDER, 800, -1 * H)), 'species');
  assert.equal(fitReason(t, sp, true, c(A, PIKE, 400, -1 * H)), 'too_short');
  assert.equal(fitReason(t, sp, true, c(A, PIKE, 800, -30 * H)), 'before');
  assert.equal(fitReason(t, sp, true, { ...c(A, PIKE, 800, 73 * H), received_at: iso(73 * H) }), 'after');
  assert.equal(fitReason(t, sp, true, { ...c(A, PIKE, 800, 1 * H), received_at: iso(0) }), 'clock');
  assert.equal(fitReason(t, sp, true, { ...c(A, PIKE, 800, 71 * H), received_at: iso(97 * H) }), 'late');
  assert.equal(fitReason(t, sp, true, c(A, PIKE, 800, -1 * H)), 'ok');
});

test('vėlai prisijungusiam įskaitomi tik po prisijungimo pagauti laimikiai', () => {
  const t = { format: 'biggest', top_n: 3, min_length_mm: 0, starts_at: '2026-10-27T10:00:00Z', ends_at: '2026-10-27T20:00:00Z' };
  const c = (user_id, length_mm, at) => ({ user_id, length_mm, status: 'approved', species_id: 1, captured_at_device: at, received_at: at });
  assert.equal(fitReason(t, [], '2026-10-27T12:00:00Z', c('a', 900, '2026-10-27T11:00:00Z')), 'before_join');
  assert.equal(fitReason(t, [], '2026-10-27T12:00:00Z', c('a', 900, '2026-10-27T12:00:00Z')), 'ok', 'prisijungimo momentu – jau įskaitoma');
  assert.equal(fitReason(t, [], true, c('a', 900, '2026-10-27T11:00:00Z')), 'ok', 'be joined_at – kaip anksčiau');
  assert.equal(fitReason(t, [], '2026-10-27T09:00:00Z', c('a', 900, '2026-10-27T09:30:00Z')), 'before', 'prieš startą lieka „before“');
  const rows = computeLeaderboard({
    tournament: t,
    entries: [{ user_id: 'late', joined_at: '2026-10-27T12:00:00Z' }, { user_id: 'early', joined_at: '2026-10-26T12:00:00Z' }],
    catches: [c('late', 900, '2026-10-27T11:00:00Z'), c('late', 500, '2026-10-27T13:00:00Z'), c('early', 700, '2026-10-27T11:00:00Z')]
  });
  assert.deepEqual(rows.map((r) => [r.user_id, r.score_mm, r.rank]), [['early', 700, 1], ['late', 500, 2]]);
  assert.deepEqual(computeLeaderboard({ tournament: t, entries: ['late'], catches: [c('late', 900, '2026-10-27T11:00:00Z')] })
    .map((r) => r.score_mm), [900], 'senas formatas (tik ID) veikia');
});
