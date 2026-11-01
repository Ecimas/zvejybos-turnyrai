import test from 'node:test';
import assert from 'node:assert/strict';
import { dayMonth } from '../../src/views/tournaments.js';

test('artėjančio turnyro data – Lietuvos laiku, lietuviškas mėnuo', () => {
  assert.deepEqual(dayMonth('2026-11-08T16:00:00Z'), { day: 8, month: 'lapkr.' });
  assert.deepEqual(dayMonth('2026-12-31T23:30:00Z'), { day: 1, month: 'saus.' });
  assert.deepEqual(dayMonth('2026-06-30T20:59:00Z'), { day: 30, month: 'birž.' });
});
