import { test } from 'node:test';
import assert from 'node:assert/strict';
import { projectRank, projectionText } from '../../src/lib/projection.js';

const T = { id: 't', format: 'biggest', top_n: 3, min_length_mm: 0, starts_at: '2026-01-01T00:00:00Z', ends_at: '2099-01-01T00:00:00Z', species_ids: [] };
const board = [{ user_id: 'a', rank: 1, score_mm: 410 }, { user_id: 'b', rank: 2, score_mm: 390 }, { user_id: 'me', rank: 3, score_mm: 350 }];
const mine = [{ id: 'm1', status: 'approved', species_id: 2, length_mm: 350, captured_at_device: '2026-10-01T10:00:00Z', received_at: '2026-10-01T10:00:00Z' }];
const draft = (len) => ({ species_id: 2, length_mm: len, captured_at_device: new Date().toISOString() });

test('vieta su nauju laimikiu', () => {
  const up = projectRank(T, board, 'me', mine, draft(400));
  assert.deepEqual([up.rank, up.was, up.improved, up.gap], [2, 3, true, 10]);
  assert.equal(projectionText(up), 'Pakiltum iš #3 į #2');
  const tie = projectRank(T, board, 'me', mine, draft(410));
  assert.equal(tie.rank, 2, 'lygus – aukščiau tas, kas pasiekė anksčiau');
  const top = projectRank(T, board, 'me', mine, draft(500));
  assert.equal(projectionText(top), 'Pakiltum iš #3 į #1');
  const same = projectRank(T, board, 'me', mine, draft(300));
  assert.equal(projectionText(same), 'Vieta nesikeistų (#3)');
  const fresh = projectRank(T, board.filter((r) => r.user_id !== 'me'), 'me', [], draft(395));
  assert.equal(projectionText(fresh), 'Būtum #2 iš 3');
  const sum = projectRank({ ...T, format: 'top_n_sum' }, board, 'me', mine, draft(100));
  assert.equal(projectionText(sum), 'Pakiltum iš #3 į #1', '350 + 100 = 450');
  assert.equal(projectRank({ ...T, leaderboard_hidden: true }, board, 'me', mine, draft(400)), null);
  assert.equal(projectRank({ ...T, format: 'duels' }, board, 'me', mine, draft(400)), null);
});
