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

import { isHoliday, easter, businessDaysLeft } from '../../src/lib/workdays.js';

test('Lietuvos šventės ir Velykos', () => {
  assert.equal(easter(2026), '2026-04-05');
  assert.equal(easter(2027), '2027-03-28');
  assert.ok(isHoliday('2026-04-06'), 'Velykų pirmadienis');
  assert.ok(isHoliday('2026-11-02') && isHoliday('2026-12-24') && isHoliday('2026-07-06'));
  assert.ok(!isHoliday('2026-11-03'));
  // Gruodžio 23 (trečiadienis) + 3 d. d.: 24, 25, 26 – šventės, 27 sekmadienis -> 28, 29, 30
  assert.equal(addBusinessDays(Date.parse('2026-12-23T10:00:00Z'), 3).toISOString(), '2026-12-30T10:00:00.000Z');
  // Spalio 30 (penktadienis) + 1 d. d.: lapkr. 2 – Vėlinės -> lapkr. 3
  assert.equal(addBusinessDays(Date.parse('2026-10-30T10:00:00Z'), 1).toISOString(), '2026-11-03T10:00:00.000Z');
  assert.equal(businessDaysLeft('2026-11-05T10:00:00Z', Date.parse('2026-11-02T10:00:00Z')), 3);
  assert.equal(businessDaysLeft('2026-11-01T10:00:00Z', Date.parse('2026-11-02T10:00:00Z')), -1);
});
