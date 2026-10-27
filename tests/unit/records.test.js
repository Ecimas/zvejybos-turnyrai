import { test } from 'node:test';
import assert from 'node:assert/strict';
import { previousBest, recordFor, recordIds, fromQueue } from '../../src/lib/records.js';

const c = (id, sp, len, status = 'approved', day = 1) => ({
  id, species_id: sp, length_mm: len, status, captured_at_device: `2026-10-${String(day).padStart(2, '0')}T08:00:00Z`
});

test('ankstesnis rekordas: atmesti neskaičiuojami, laukiantys – taip', () => {
  const list = [c('a', 1, 700), c('b', 1, 900, 'rejected'), c('c', 1, 780, 'pending'), c('d', 2, 300)];
  assert.equal(previousBest(list, 1), 780);
  assert.equal(previousBest(list, 2), 300);
  assert.equal(previousBest(list, 3), null);
  assert.equal(previousBest(list, 1, 'c'), 700, 'pats laimikis į palyginimą neįeina');
});

test('naujas rekordas, pirmoji rūšis ir ne rekordas', () => {
  const list = [c('a', 1, 700)];
  assert.deepEqual(recordFor(list, 1, 750), { kind: 'record', previous: 700 });
  assert.deepEqual(recordFor(list, 1, 700), { kind: null, previous: 700 }, 'lygus – ne rekordas');
  assert.deepEqual(recordFor(list, 2, 300), { kind: 'first', previous: null });
});

test('rekordų žymės: po vieną rūšiai, lygių – ankstesnis', () => {
  const ids = recordIds([c('a', 1, 700, 'approved', 2), c('b', 1, 700, 'approved', 1), c('x', 1, 950, 'rejected'), c('d', 2, 300)]);
  assert.deepEqual([...ids].sort(), ['b', 'd']);
});

test('eilės įrašas paverčiamas laimikiu', () => {
  const q = fromQueue({ clientId: 'q1', speciesId: 1, lengthMm: 650, capturedAt: '2026-10-27T08:00:00Z', state: 'queued' });
  assert.equal(q.status, 'pending');
  assert.equal(fromQueue({ clientId: 'q2', speciesId: 1, lengthMm: 1, state: 'failed' }).status, 'rejected');
});
