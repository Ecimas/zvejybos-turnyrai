import { test } from 'node:test';
import assert from 'node:assert/strict';
import { thumbPathOf, makeThumb } from '../../src/lib/device.js';

test('miniatiūros kelias: šalia originalo, tik jpg/webp, ne miniatiūrai', () => {
  assert.equal(thumbPathOf('u1/abc.webp'), 'u1/abc.t.webp');
  assert.equal(thumbPathOf('u1/abc.jpg'), 'u1/abc.t.jpg');
  assert.equal(thumbPathOf('u1/abc.t.jpg'), null);
  assert.equal(thumbPathOf('u1/abc.png'), null);
  assert.equal(thumbPathOf(''), null);
  assert.equal(thumbPathOf(null), null);
  // Atitinka serverio taisyklę: miniatiūros → originalo kelias
  for (const p of ['u1/abc.webp', 'u1/check-1.jpg']) {
    assert.equal(thumbPathOf(p).replace(/\.t\.(jpg|webp)$/, '.$1'), p);
  }
});

test('be naršyklės miniatiūra nekuriama – grąžinama null, o ne klaida', async () => {
  assert.equal(await makeThumb(null), null);
  assert.equal(await makeThumb(new Blob(['x'], { type: 'image/jpeg' })), null);
});
