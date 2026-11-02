import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addBusinessDays } from '../../src/backend/messages_demo.js';

test('3 darbo dienos: savaitgalis neskaičiuojamas', () => {
  // 2026-11-06 – penktadienis; +3 d. d. = trečiadienis 11-11
  assert.equal(addBusinessDays(Date.parse('2026-11-06T10:00:00Z'), 3).toISOString(), '2026-11-11T10:00:00.000Z');
  // Pirmadienis + 3 = ketvirtadienis
  assert.equal(addBusinessDays(Date.parse('2026-11-02T10:00:00Z'), 3).toISOString(), '2026-11-05T10:00:00.000Z');
  // Šeštadienis + 1 = pirmadienis
  assert.equal(addBusinessDays(Date.parse('2026-11-07T10:00:00Z'), 1).toISOString(), '2026-11-09T10:00:00.000Z');
});
