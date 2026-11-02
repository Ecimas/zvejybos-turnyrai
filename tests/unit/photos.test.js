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

test('vietos skaitiklis: procentai, įspėjimas nuo 80 %, kiek dar tilps', async () => {
  const { storageCard, fmtBytes } = await import('../../src/views/admin.js');
  const GB = 1024 ** 3;
  assert.equal(fmtBytes(19.6 * 1024 ** 2), '19,6 MB');
  assert.equal(fmtBytes(45 * 1024), '0,04 MB');
  assert.equal(fmtBytes(1.25 * GB), '1,25 GB');
  const low = String(storageCard([{ bucket: 'catch-photos', files: 100, bytes: 100 * 200 * 1024, thumbs: 0, thumb_bytes: 0 }]));
  assert.match(low, /st-ok/);
  assert.doesNotMatch(low, /data-storage-warn/);
  assert.match(low, /~200 KB/);
  const warn = String(storageCard([{ bucket: 'catch-photos', files: 6000, bytes: 0.85 * GB, thumbs: 5000, thumb_bytes: 80 * 1024 ** 2 },
    { bucket: 'sponsor-logos', files: 3, bytes: 60000, thumbs: 0, thumb_bytes: 0 }]));
  assert.match(warn, /st-warn/);
  assert.match(warn, /data-storage-warn/);
  assert.match(warn, /su maža kopija/);
  assert.ok(warn.indexOf('Laimikių nuotraukos') < warn.indexOf('Rėmėjų logotipai'), 'nuotraukos pirmos');
  const full = String(storageCard([{ bucket: 'catch-photos', files: 9000, bytes: 0.97 * GB, thumbs: 0, thumb_bytes: 0 }]));
  assert.match(full, /st-bad/);
  assert.match(full, /beveik baigėsi/);
  // Mažai nuotraukų – vidurkis numatytasis (110 KB), ne atsitiktinis
  const few = String(storageCard([{ bucket: 'catch-photos', files: 3, bytes: 3 * 900 * 1024, thumbs: 0, thumb_bytes: 0 }]));
  assert.match(few, /~110 KB/);
});
