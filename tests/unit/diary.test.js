import test from 'node:test';
import assert from 'node:assert/strict';
import { groupTimeline } from '../../src/views/diary.js';

test('dienoraščio grupės: šių metų mėnesiai atskirai, seni metai – viena grupė', () => {
  const now = new Date(2026, 10, 1, 12);
  const at = (y, m, d) => new Date(y, m, d, 10).toISOString();
  const items = [at(2026, 10, 1), at(2026, 9, 31), at(2026, 9, 2), at(2026, 8, 26), at(2025, 6, 4), at(2025, 2, 1), at(2024, 0, 5)]
    .map((x) => ({ kind: 'catch', at: x }));
  const g = groupTimeline(items, now);
  assert.deepEqual(g.map((x) => [x.key, x.title, x.items.length]), [
    ['2026-11', 'Lapkritis', 1], ['2026-10', 'Spalis', 2], ['2026-09', 'Rugsėjis', 1],
    ['2025', 'Visi 2025 m. laimikiai', 2], ['2024', 'Visi 2024 m. laimikiai', 1]
  ]);
});
