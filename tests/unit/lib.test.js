import { test } from 'node:test';
import assert from 'node:assert/strict';
import { html, esc, raw } from '../../src/lib/html.js';
import { cm, duration, plural, phase } from '../../src/lib/format.js';
import { Outbox, memoryStore, PermanentError } from '../../src/lib/outbox.js';

test('html ištrūkina vartotojo tekstą', () => {
  const name = '<img src=x onerror=alert(1)>';
  assert.equal(String(html`<b>${name}</b>`), '<b>&lt;img src=x onerror=alert(1)&gt;</b>');
  assert.equal(esc(`"'\``), '&quot;&#39;&#96;');
  assert.equal(String(html`<i>${raw('<svg></svg>')}</i>`), '<i><svg></svg></i>');
  assert.equal(String(html`${['<a>', html`<b>${'&'}</b>`]}`), '&lt;a&gt;<b>&amp;</b>');
  assert.equal(String(html`${null}${undefined}${false}${0}`), '0');
});

test('formatavimas', () => {
  assert.equal(cm(780), '78 cm');
  assert.equal(cm(785), '78,5 cm');
  assert.equal(duration((2 * 24 + 14) * 3600e3 + 5 * 60e3), '2 d. 14 val.');
  assert.equal(duration(5 * 3600e3 + 12 * 60e3), '5 val. 12 min.');
  assert.equal(duration(30e3), '1 min.');
  assert.equal(plural(1, 'laimikis', 'laimikiai', 'laimikių'), 'laimikis');
  assert.equal(plural(3, 'laimikis', 'laimikiai', 'laimikių'), 'laimikiai');
  assert.equal(plural(12, 'laimikis', 'laimikiai', 'laimikių'), 'laimikių');
  assert.equal(plural(21, 'laimikis', 'laimikiai', 'laimikių'), 'laimikis');
  assert.equal(plural(20, 'laimikis', 'laimikiai', 'laimikių'), 'laimikių');
  const t = { starts_at: new Date(1000).toISOString(), ends_at: new Date(2000).toISOString() };
  assert.equal(phase(t, 500), 'soon');
  assert.equal(phase(t, 1500), 'live');
  assert.equal(phase(t, 2000), 'done');
});

test('eilė: išsiunčia ir pašalina', async () => {
  const box = new Outbox(memoryStore());
  await box.add({ clientId: '1', v: 1 });
  await box.add({ clientId: '2', v: 2 });
  const sent = [];
  const r = await box.flush(async (it) => { sent.push(it.clientId); });
  assert.deepEqual(sent, ['1', '2']);
  assert.equal(r.sent, 2);
  assert.equal(await box.pendingCount(), 0);
});

test('eilė: be ryšio sustoja ir išsaugo', async () => {
  const box = new Outbox(memoryStore());
  await box.add({ clientId: '1' });
  await box.add({ clientId: '2' });
  const r = await box.flush(async () => { throw new TypeError('Failed to fetch'); });
  assert.equal(r.stopped, true);
  assert.equal(await box.pendingCount(), 2);
  const r2 = await box.flush(async () => {});
  assert.equal(r2.sent, 2);
});

test('eilė: nuolatinė klaida pažymima, kiti siunčiami', async () => {
  const box = new Outbox(memoryStore());
  await box.add({ clientId: '1' });
  await box.add({ clientId: '2' });
  const r = await box.flush(async (it) => {
    if (it.clientId === '1') throw new PermanentError('Ši nuotrauka jau įkelta', 'duplicate_photo');
  });
  assert.equal(r.sent, 1);
  assert.equal(r.failed, 1);
  const left = await box.list();
  assert.equal(left.length, 1);
  assert.equal(left[0].state, 'failed');
  assert.equal(left[0].error, 'Ši nuotrauka jau įkelta');
  assert.equal(await box.pendingCount(), 0);
});

test('eilė: lygiagretus flush nesiunčia dukart', async () => {
  const box = new Outbox(memoryStore());
  await box.add({ clientId: '1' });
  let calls = 0;
  const send = async () => { calls++; await new Promise((r) => setTimeout(r, 20)); };
  await Promise.all([box.flush(send), box.flush(send)]);
  assert.equal(calls, 1);
});
