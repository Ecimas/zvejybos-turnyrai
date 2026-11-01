import test from 'node:test';
import assert from 'node:assert/strict';
import { seasonPoints, challengeTop, clubRecords, clubLeaguePoints, challengeSpecies, feat } from '../../src/lib/clubs.js';

const c = (id, user, sp, len, at, status = 'approved') => ({ id, user_id: user, species_id: sp, length_mm: len, captured_at_device: at, status });
const Y = new Date().getFullYear();
const catches = [
  c('a', 'u1', 1, 700, `${Y}-03-01T10:00:00`), c('b', 'u1', 2, 300, `${Y}-03-02T10:00:00`), c('x', 'u1', 1, 990, `${Y}-03-03T10:00:00`, 'rejected'),
  c('d', 'u2', 1, 820, `${Y}-03-05T10:00:00`), c('e', 'u3', 2, 410, `${Y}-02-10T10:00:00`), c('f', 'u4', 1, 950, `${Y}-03-06T10:00:00`)
];

test('sezono taškai – 10 didžiausių patvirtintų, cm', () => {
  assert.equal(seasonPoints(catches, 'u1', Y), 100);
  assert.equal(seasonPoints(catches, 'u1', Y - 1), 0);
  const many = Array.from({ length: 12 }, (_, i) => c(`m${i}`, 'u9', 2, 100 + i * 10, `${Y}-05-01T10:00:00`));
  assert.equal(seasonPoints(many, 'u9', Y), Math.round([210, 200, 190, 180, 170, 160, 150, 140, 130, 120].reduce((s, x) => s + x, 0) / 10));
});

test('iššūkis: rūšis pagal mėnesį, tik nariai, tik patvirtinti', () => {
  assert.equal(challengeSpecies(new Date(Y, 1, 10)), 2);
  assert.equal(challengeSpecies(new Date(Y, 5, 10)), null);
  const feb = challengeTop(catches, ['u1', 'u2', 'u3'], new Date(Y, 1, 15));
  assert.deepEqual(feb.top.map((t) => [t.user_id, t.len]), [['u3', 410]]);
  const mar = challengeTop(catches, ['u1', 'u2', 'u3'], new Date(Y, 2, 15));
  assert.equal(mar.species_id, null);
  assert.deepEqual(mar.top.map((t) => [t.user_id, t.len]), [['u2', 820], ['u1', 700]], 'atmestas 99 cm neįskaitomas, u4 ne narys');
});

test('rekordai ir lyga', () => {
  const r = clubRecords(catches, ['u1', 'u2', 'u3'], Y);
  assert.deepEqual(r.records.map((x) => [x.species_id, x.len]), [[1, 820], [2, 410]]);
  assert.deepEqual(r.season.map((x) => x.user_id), ['u1', 'u2', 'u3']);
  assert.equal(clubLeaguePoints(catches, ['u1', 'u2', 'u3'], Y), 100 + 82 + 41);
});

test('funkcijų jungikliai: nežinomas – įjungtas', () => {
  assert.equal(feat({}, 'club_trips'), true);
  assert.equal(feat({ features: { club_trips: false } }, 'club_trips'), false);
  assert.equal(feat({ features: { club_trips: true } }, 'club_map'), true);
});
